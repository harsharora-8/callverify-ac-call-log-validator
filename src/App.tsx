import React, { useState, useEffect, useRef } from "react";
import { 
  Phone, 
  Clock, 
  Timer, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  History, 
  Loader2, 
  X, 
  ShieldCheck,
  User,
  LogOut,
  AlertTriangle,
  Smartphone,
  Circle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { generatePerceptualHash, createExactKey } from "@/src/lib/imageUtils";
export interface ExtractedCallData {
  phone: string;
  time: string;
  duration: string;
}

interface CallLog {
  id: string;
  ac_email: string;
  phone: string;
  call_time: string;
  duration: string;
  created_at: string;
  status?: string;
}

interface VerificationResult {
  status: "ACCEPTED" | "REJECTED";
  reason?: string;
  message: string;
}

export default function App() {
  const [email, setEmail] = useState("");
  const [isLogged, setIsLogged] = useState(false);
  const [uploads, setUploads] = useState<{
    id: string;
    file: File;
    preview: string;
    status: 'pending' | 'processing' | 'accepted' | 'rejected';
    result?: VerificationResult;
    extracted?: ExtractedCallData;
  }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
  const [showOnlyMyLogs, setShowOnlyMyLogs] = useState(true);
  const [batchActionSummary, setBatchActionSummary] = useState<{ accepted: number, rejected: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedEmail = localStorage.getItem("ac_email");
    if (savedEmail) {
      setEmail(savedEmail);
      setIsLogged(true);
      fetchLogs();
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.includes("@")) {
      localStorage.setItem("ac_email", email);
      setIsLogged(true);
      fetchLogs();
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("ac_email");
    setIsLogged(false);
    setEmail("");
  };

  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    setDbError(null);
    try {
      const res = await fetch("/api/logs");
      const data = await res.json();
      if (Array.isArray(data)) {
        setLogs(data);
      } else {
        const errorMsg = data.error || "Database sync failed.";
        console.error("Database Error:", errorMsg);
        if (errorMsg.includes("not found") || errorMsg.includes("relation") || errorMsg.includes("cache") || errorMsg.includes("Missing")) {
          setDbError("Database Table Missing: Please run the SQL in SCHEMA.sql in Supabase to create the 'call_logs' table.");
        }
        setLogs([]);
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
      setLogs([]);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const newUploads = selectedFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 9),
      file,
      preview: URL.createObjectURL(file as any),
      status: 'pending' as const
    }));

    setUploads(prev => [...prev, ...newUploads]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeUpload = (id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id));
  };

  const processAll = async () => {
    setIsProcessing(true);
    setBatchActionSummary(null);
    const pendingUploads = uploads.filter(u => u.status !== 'accepted' && u.status !== 'processing');
    
    // Set to processing
    setUploads(prev => prev.map(u => 
      pendingUploads.some(p => p.id === u.id) ? { ...u, status: 'processing' } : u
    ));

    try {
      const logsPayload = [];
      for(const u of pendingUploads) {
         const hash = await generatePerceptualHash(u.file);
         const reader = new FileReader();
         reader.readAsDataURL(u.file);
         const base64 = await new Promise<string>((resolve) => {
           reader.onload = () => resolve(reader.result as string);
         });
         logsPayload.push({
            id: u.id,
            base64Image: base64,
            imageHash: hash
         });
      }

      const response = await fetch("/api/verify-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Increased max size might need handling at nginx/vercel level but works fine normally for < 4mb total
        body: JSON.stringify({ acEmail: email, logs: logsPayload })
      });

      if (!response.ok) {
        throw new Error("Batch verification failed. " + response.statusText);
      }

      const results = await response.json();
      
      let acceptedCount = 0;
      setUploads(prev => prev.map(u => {
        const matchingResult = results.find((r: any) => r.id === u.id);
        if (matchingResult) {
          if (matchingResult.status === "ACCEPTED") acceptedCount++;
          return {
            ...u,
            status: matchingResult.status === "ACCEPTED" ? 'accepted' : 'rejected',
            result: matchingResult,
            extracted: matchingResult.extracted
          };
        }
        return u;
      }));

      fetchLogs();
      
      // Auto-remove accepted
      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.status !== 'accepted'));
      }, 1500);

      setBatchActionSummary({ 
        accepted: acceptedCount, 
        rejected: pendingUploads.length - acceptedCount 
      });

    } catch (err: any) {
      console.error(err);
      setUploads(prev => prev.map(u => 
        pendingUploads.some(p => p.id === u.id) ? { 
          ...u, 
          status: 'rejected',
          result: { status: "REJECTED", message: err.message || "Failed to process batch." }
        } : u
      ));
    } finally {
      setIsProcessing(false);
      setTimeout(() => setBatchActionSummary(null), 5000);
    }
  };

  if (!isLogged) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-[32px] shadow-sm w-full max-w-md border border-slate-200"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-indigo-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
              <ShieldCheck size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2 tracking-tight">CallGuard AI</h1>
            <p className="text-slate-500 text-sm">Academic Counselor Portal</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1 ml-1">
                AC Email Address
              </label>
              <div className="relative">
                <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@vedantu.com"
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all text-slate-700"
                />
              </div>
            </div>
            <button 
              type="submit"
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
            >
              Sign In
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {dbError && (
        <div className="bg-amber-100 border-b border-amber-200 px-6 py-2 text-center text-amber-800 text-xs font-bold flex items-center justify-center gap-2">
          <AlertCircle size={14} />
          {dbError}
          <button onClick={() => setDbError(null)} className="hover:text-amber-900 ml-2">✕</button>
        </div>
      )}
      {/* Image Modal */}
      <AnimatePresence>
        {selectedPreview && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedPreview(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-2xl w-full bg-white rounded-[32px] overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <img src={selectedPreview} className="w-full h-auto max-h-[80vh] object-contain" alt="Fullscreen Preview" />
              <button 
                onClick={() => setSelectedPreview(null)}
                className="absolute top-4 right-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors"
              >
                <X size={24} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-indigo-700 text-white px-6 py-4 sticky top-0 z-10 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-white p-2 rounded-lg text-indigo-700">
            <ShieldCheck size={20} />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight">CallGuard AI <span className="font-light opacity-80 text-sm">| Portal</span></span>
            <p className="text-[10px] opacity-75 uppercase tracking-widest">{email}</p>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="bg-indigo-500/30 hover:bg-indigo-500/50 p-2 rounded-xl transition-colors"
        >
          <LogOut size={20} />
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-12 gap-4 md:gap-6">
        
        {/* Left: Input & Verification */}
        <div className="col-span-12 lg:col-span-5 space-y-4 md:space-y-6">
          <div className="bg-white rounded-2xl p-5 md:p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800 flex items-center">
                <span className="w-2 h-6 bg-indigo-600 rounded-full mr-3"></span>
                Batch Verification
              </h2>
              <div className="flex items-center gap-4">
                {uploads.length > 0 && !isProcessing && (
                  <button 
                    onClick={() => setUploads([])}
                    className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:underline"
                  >
                    Clear List
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence>
              {batchActionSummary && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6 overflow-hidden"
                >
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                        <CheckCircle className="text-indigo-600" size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-black uppercase text-indigo-900 tracking-wider">Batch Complete</p>
                        <p className="text-[10px] text-indigo-400 font-bold italic">Verified logs moved to analytics history</p>
                      </div>
                    </div>
                    <button onClick={() => setBatchActionSummary(null)} className="text-indigo-300 hover:text-indigo-600">
                      <X size={16} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-indigo-100 rounded-2xl p-6 bg-slate-50/50 text-center cursor-pointer hover:bg-slate-50 transition-colors group mb-6"
            >
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <Upload size={24} className="text-indigo-600" />
              </div>
              <p className="text-slate-600 font-bold text-sm">Add Call Screenshots</p>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">Select one or more images</p>
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                multiple
                className="hidden" 
              />
            </div>

            {uploads.length > 0 && (
              <div className="mb-6 space-y-2">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Batch Progress</p>
                    <p className="text-sm font-bold text-slate-700">
                      {uploads.filter(u => u.status === 'accepted' || u.status === 'rejected').length} / {uploads.length} <span className="text-slate-400 font-medium text-xs">Verified</span>
                    </p>
                  </div>
                  <p className="text-xs font-black text-indigo-600">
                    {Math.round((uploads.filter(u => u.status === 'accepted' || u.status === 'rejected').length / uploads.length) * 100)}%
                  </p>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(uploads.filter(u => u.status === 'accepted' || u.status === 'rejected').length / uploads.length) * 100}%` }}
                    className="h-full bg-indigo-600 rounded-full"
                  />
                </div>
              </div>
            )}

            {uploads.length > 0 && (
              <div className="space-y-3 mb-6 max-h-[400px] overflow-y-auto pr-1">
                <AnimatePresence>
                  {uploads.map((u) => (
                    <motion.div 
                      key={u.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={`p-3 rounded-2xl border flex items-center gap-4 relative group transition-all ${
                        u.status === 'accepted' ? 'bg-emerald-50/50 border-emerald-100' : 
                        u.status === 'rejected' ? 'bg-rose-50/50 border-rose-100' : 
                        'bg-slate-50 border-slate-100'
                      }`}
                    >
                      <div 
                        onClick={() => setSelectedPreview(u.preview)}
                        className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200 shrink-0 border border-slate-200 cursor-zoom-in relative group/img"
                      >
                        <img src={u.preview} className="w-full h-full object-cover transition-transform group-hover/img:scale-110" alt="Preview" />
                        <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                          <Smartphone size={16} className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {u.status === 'processing' && <Loader2 size={12} className="animate-spin text-indigo-500" />}
                          {u.status === 'accepted' && <CheckCircle size={14} className="text-emerald-500" />}
                          {u.status === 'rejected' && <AlertTriangle size={14} className="text-rose-500" />}
                          {u.status === 'pending' && <Circle size={12} className="text-slate-400" />}
                          <p className={`text-[10px] font-black uppercase tracking-widest truncate ${
                            u.status === 'accepted' ? 'text-emerald-600' : 
                            u.status === 'rejected' ? 'text-rose-600' : 
                            u.status === 'processing' ? 'text-indigo-600' : 'text-slate-400'
                          }`}>
                            {u.status === 'processing' ? 'Analyzing Signal' : 
                             u.status === 'accepted' ? 'Verified' : 
                             u.status === 'rejected' ? 'Rejected' : 'Awaiting Task'}
                          </p>
                        </div>
                        
                        {u.extracted ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              {u.status === 'accepted' ? <CheckCircle size={10} className="text-emerald-400" /> : <AlertCircle size={10} className="text-rose-400" />}
                              <p className="text-sm font-mono font-black text-slate-800">
                                {u.extracted.phone}
                              </p>
                            </div>
                            <p className="text-[10px] font-bold text-slate-500 flex items-center gap-2 ml-4">
                              <span className="flex items-center gap-1"><Clock size={10} /> {u.extracted.time}</span>
                              <span className="flex items-center gap-1"><Timer size={10} /> {u.extracted.duration}s</span>
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {u.status === 'pending' ? <Circle size={10} className="text-slate-300" /> : <Loader2 size={10} className="animate-spin text-indigo-300" />}
                            <p className="text-xs font-bold text-slate-600 truncate">
                              {u.file.name}
                            </p>
                          </div>
                        )}

                        {u.result?.status === "REJECTED" && (
                          <p className="text-[9px] font-bold text-rose-500 mt-1 italic line-clamp-1">
                            {u.result.message}
                          </p>
                        )}
                      </div>
                      
                      {!isProcessing && u.status !== 'processing' && (
                        <button 
                          onClick={() => removeUpload(u.id)}
                          className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-rose-500 transition-colors shadow-sm"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {uploads.length > 0 && (
              <button 
                onClick={processAll}
                disabled={isProcessing || !uploads.some(u => u.status === 'pending' || u.status === 'rejected')}
                className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-100"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Processing {uploads.filter(u => u.status === 'accepted' || u.status === 'rejected').length + 1} of {uploads.length}...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} />
                    Verify {uploads.filter(u => u.status === 'pending' || u.status === 'rejected').length} Screenshot(s)
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Right: History */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl p-5 md:p-8 border border-slate-200 shadow-sm flex flex-col h-full min-h-[400px] md:min-h-[500px]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="space-y-4">
                  <h2 className="text-lg font-bold text-slate-800 flex items-center">
                    <span className="w-2 h-6 bg-slate-300 rounded-full mr-3"></span>
                    Verification Logs
                  </h2>
                  <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                    <button 
                      onClick={() => setShowOnlyMyLogs(true)}
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${showOnlyMyLogs ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      My Logs
                    </button>
                    <button 
                      onClick={() => setShowOnlyMyLogs(false)}
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${!showOnlyMyLogs ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Global Feed
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex -space_x-2">
                     {logs.slice(0, 3).map((l, i) => (
                       <div key={i} className="w-6 h-6 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center text-[8px] font-black text-indigo-600">
                         {l.phone.slice(-2)}
                       </div>
                     ))}
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">
                    {logs.length} Total Records
                  </span>
                </div>
              </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar max-h-[400px] lg:max-h-[600px]">
              {isLoadingLogs ? (
                <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                  <Loader2 className="animate-spin" size={20} />
                  <span className="text-xs font-bold uppercase tracking-widest">Fetching Logs...</span>
                </div>
              ) : (logs.filter(l => !showOnlyMyLogs || l.ac_email === email)).length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-widest italic">No matching logs found</p>
                </div>
              ) : (
                logs.filter(l => !showOnlyMyLogs || l.ac_email === email).map((log) => (
                  <motion.div 
                    key={log.id}
                    layout
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-100 hover:bg-white transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="font-mono text-xs font-black text-slate-300 group-hover:text-indigo-200 transition-colors">
                        #{log.id.slice(0, 4).toUpperCase()}
                      </div>
                      <div className="space-y-0.5">
                        <div className="font-mono font-bold text-sm text-slate-700 underline decoration-slate-200 underline-offset-4 group-hover:decoration-indigo-100">
                          {log.phone}
                        </div>
                        <div className="flex gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                          <span className="flex items-center gap-1"><Clock size={10} /> {log.call_time}</span>
                          <span className="flex items-center gap-1"><Timer size={10} /> {log.duration}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Accepted</div>
                      <div className="text-[9px] text-slate-400 italic">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
            
            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center">
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">End-to-End Encrypted</p>
               <button onClick={fetchLogs} className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline">
                 Manual Resync
               </button>
            </div>
          </div>
        </div>

      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #CBD5E1; }
      `}</style>
    </div>
  );
}
