
import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Trash2,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  Plus,
  CircleStop,
  ChevronRight,
  Settings,
  Zap,
  Edit3,
  XCircle,
  Play,
  Monitor,
  Layers,
  Search,
  Radio,
  AlertCircle,
  Download,
  Circle
} from 'lucide-react';
import { AppTab, ECMData, ADXFile, GaugeTheme } from './types';
import { parseADX } from './utils/adxParser';
import { analyzeEngineState, getDTCExplanation } from './services/geminiService';

const THEMES: Record<GaugeTheme, any> = {
  neon: { 
    bg: 'bg-[#020205]', 
    card: 'bg-[#0a0a15] border-cyan-500/20', 
    text: 'text-cyan-400', 
    accent: '#22d3ee', 
    glow: 'shadow-[0_0_15px_rgba(34,211,238,0.1)]',
    gauge: '#22d3ee'
  },
  carbon: { 
    bg: 'bg-[#050505]', 
    card: 'bg-zinc-900/50 border-red-600/30', 
    text: 'text-red-500', 
    accent: '#ef4444', 
    glow: 'shadow-[0_0_10px_rgba(239,68,68,0.1)]',
    gauge: '#ef4444'
  },
  retro: { 
    bg: 'bg-[#000800]', 
    card: 'bg-black border-green-500/20', 
    text: 'text-green-500', 
    accent: '#22c55e', 
    glow: '',
    gauge: '#22c55e'
  }
};

// Cirkulär mätarkomponent likt ALDLdroid
const CircularGauge = ({ value, min, max, label, unit, color }: any) => {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center relative w-full aspect-square p-2">
      <svg className="w-full h-full transform -rotate-90">
        <circle
          cx="50%" cy="50%" r={radius}
          stroke="currentColor" strokeWidth="6" fill="transparent"
          className="text-white/5"
        />
        <circle
          cx="50%" cy="50%" r={radius}
          stroke={color} strokeWidth="6" fill="transparent"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: offset, transition: 'stroke-dashoffset 0.3s ease' }}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">{label}</span>
        <span className="text-2xl font-black font-mono tracking-tighter tabular-nums leading-none">
          {typeof value === 'number' ? value.toFixed(1) : value}
        </span>
        <span className="text-[7px] font-bold opacity-30 mt-1">{unit}</span>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [currentAdxId, setCurrentAdxId] = useState<string | null>(() => localStorage.getItem('aldl_current_adx_v3'));
  const [activeTab, setActiveTab] = useState<AppTab>(() => currentAdxId ? AppTab.DASHBOARD : AppTab.CONNECTION);
  const [theme, setTheme] = useState<GaugeTheme>(() => (localStorage.getItem('aldl_theme_v3') as GaugeTheme) || 'neon');
  const [adxLibrary, setAdxLibrary] = useState<ADXFile[]>(() => {
    const saved = localStorage.getItem('aldl_library_v3');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [isConnected, setIsConnected] = useState(false);
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  
  const [isPolling, setIsPolling] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [logData, setLogData] = useState<ECMData[]>([]);
  const [telemetry, setTelemetry] = useState<ECMData>({});
  const [rxCount, setRxCount] = useState(0);
  const [txCount, setTxCount] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [engineAnalysis, setEngineAnalysis] = useState<string | null>(null);
  const [editingGaugeIdx, setEditingGaugeIdx] = useState<number | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  
  const [manualDtc, setManualDtc] = useState("");
  const [dtcExplanation, setDtcExplanation] = useState<string | null>(null);
  const [isExplainingDtc, setIsExplainingDtc] = useState(false);

  const serialPort = useRef<any>(null);
  const pollingRef = useRef<boolean>(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  
  const currentAdx = adxLibrary.find(a => a.id === currentAdxId) || null;
  const currentTheme = THEMES[theme];

  useEffect(() => {
    localStorage.setItem('aldl_library_v3', JSON.stringify(adxLibrary));
    if (currentAdxId) localStorage.setItem('aldl_current_adx_v3', currentAdxId);
    localStorage.setItem('aldl_theme_v3', theme);
  }, [adxLibrary, currentAdxId, theme]);

  const addDebug = (msg: string) => {
    setDebugLog(prev => [msg, ...prev].slice(0, 20));
  };

  const processPacket = (packet: Uint8Array) => {
    if (!currentAdx) return;
    const newData: ECMData = {
      _timestamp: new Date().toISOString()
    };
    currentAdx.parameters.forEach(p => {
      if (p.packetOffset < packet.length) {
        let rawVal = packet[p.packetOffset];
        if (p.byteCount === 2 && p.packetOffset + 1 < packet.length) {
          rawVal = (packet[p.packetOffset] << 8) | packet[p.packetOffset + 1];
        }
        const val = (rawVal * (p.scale || 1.0)) + (p.offset || 0.0);
        newData[p.id] = val;
      }
    });
    setTelemetry(newData);
    setRxCount(c => c + 1);

    if (isLogging) {
      setLogData(prev => [...prev, newData]);
    }
  };

  const handleLinkHardware = async () => {
    setScanError(null);
    setIsScanning(true);
    await new Promise(r => setTimeout(r, 800));

    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: currentAdx?.baudRate || 8192 });
      serialPort.current = port;
      setIsConnected(true);
      setShowConnectMenu(false);
      setIsScanning(false);
      addDebug("Hardware linked.");
    } catch (e: any) {
      setIsScanning(false);
      setScanError("Link failed: " + e.message);
      addDebug("Error: " + e.message);
    }
  };

  const toggleLogging = () => {
    if (isLogging) {
      exportLogToCSV();
      setIsLogging(false);
      setLogData([]);
    } else {
      setLogData([]);
      setIsLogging(true);
    }
  };

  const exportLogToCSV = () => {
    if (logData.length === 0) return;
    const headers = Object.keys(logData[0]);
    const csvContent = [
      headers.join(','),
      ...logData.map(row => headers.map(h => row[h]).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aldl_log_${new Date().getTime()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startPolling = async () => {
    if (!currentAdx || !serialPort.current) return;
    setIsPolling(true);
    pollingRef.current = true;
    const request = new Uint8Array(currentAdx.requestCommand || [0xF4, 0x57, 0x01, 0x00, 0xB4]);

    try {
      while (pollingRef.current) {
        if (serialPort.current) {
          const writer = serialPort.current.writable.getWriter();
          await writer.write(request);
          writer.releaseLock();
          const reader = serialPort.current.readable.getReader();
          try {
            const { value } = await reader.read();
            if (value) processPacket(value);
          } finally {
            reader.releaseLock();
          }
        }
        setTxCount(c => c + 1);
        await new Promise(r => setTimeout(r, 120)); // Lite snabbare polling för bättre flyt
      }
    } catch (e: any) {
      addDebug("Bus error: " + e.message);
      setIsPolling(false);
    }
  };

  const stopPolling = () => { 
    pollingRef.current = false; 
    setIsPolling(false);
  };

  // Fix: Added missing handleExplainDtc function to satisfy onClick reference on line 406
  const handleExplainDtc = async () => {
    if (!manualDtc.trim()) return;
    setIsExplainingDtc(true);
    setDtcExplanation(null);
    try {
      const explanation = await getDTCExplanation(manualDtc);
      setDtcExplanation(explanation);
    } catch (err) {
      console.error("Gemini DTC explanation error:", err);
      setDtcExplanation("Kunde inte hämta förklaring för felkoden just nu.");
    } finally {
      setIsExplainingDtc(false);
    }
  };

  const changeGauge = (idx: number, fieldId: string) => {
    if (!currentAdxId) return;
    setAdxLibrary(prev => prev.map(adx => {
      if (adx.id !== currentAdxId) return adx;
      const param = adx.parameters.find(p => p.id === fieldId);
      if (!param) return adx;
      const newGauges = [...adx.gauges];
      newGauges[idx] = {
        ...newGauges[idx],
        label: param.title,
        unit: param.units,
        field: param.id,
        max: param.title.toUpperCase().includes("RPM") ? 7000 : 
             param.title.toUpperCase().includes("TEMP") ? 120 :
             param.title.toUpperCase().includes("TPS") ? 100 : 255
      };
      return { ...adx, gauges: newGauges };
    }));
    setEditingGaugeIdx(null);
  };

  return (
    <div className={`max-w-md mx-auto min-h-screen ${currentTheme.bg} text-white flex flex-col font-sans pb-28 relative overflow-hidden`}>
      
      {/* HEADER HUD */}
      <header className="bg-black/80 backdrop-blur-xl px-5 py-4 flex justify-between items-center border-b border-white/5 z-50 sticky top-0">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full transition-all ${isPolling ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse' : isConnected ? 'bg-cyan-500/40' : 'bg-zinc-700'}`} />
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] leading-none">
              {isConnected ? (currentAdx?.name || 'ALDL LINK ACTIVE') : 'SYSTEM OFFLINE'}
            </span>
            <div className="flex gap-2 mt-1 text-[8px] font-mono opacity-40 uppercase">
              <span className={isPolling ? 'text-cyan-400' : ''}>TX:{txCount}</span>
              <span className={isPolling ? 'text-cyan-400' : ''}>RX:{rxCount}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isConnected && (
            <button 
              onClick={toggleLogging}
              className={`p-3 rounded-xl transition-all active:scale-90 flex items-center gap-2 ${isLogging ? 'bg-red-500 text-white animate-pulse' : 'bg-white/5 text-white/40 border border-white/10'}`}
            >
              {isLogging ? <CircleStop size={18} /> : <Circle size={18} />}
              {isLogging && <span className="text-[10px] font-black uppercase tracking-tighter">{logData.length}</span>}
            </button>
          )}
          {isConnected ? (
            <button 
              onClick={isPolling ? stopPolling : startPolling}
              className={`p-3 rounded-xl transition-all active:scale-90 ${isPolling ? 'bg-red-500/20 text-red-500 border border-red-500/40' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'}`}
            >
              {isPolling ? <CircleStop size={18} /> : <Play size={18} />}
            </button>
          ) : (
             <button onClick={() => setShowConnectMenu(true)} className="p-3 bg-zinc-800 rounded-xl text-zinc-400">
                <Radio size={18} />
             </button>
          )}
        </div>
      </header>

      {/* CONNECTION OVERLAY */}
      {showConnectMenu && (
        <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
          <div className="w-full max-w-sm bg-zinc-950 border border-white/10 rounded-[3rem] p-8 space-y-6 shadow-2xl relative overflow-hidden">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-black uppercase tracking-[0.3em]">Hardware Link</h3>
              <button onClick={() => { setShowConnectMenu(false); setIsScanning(false); setScanError(null); }} className="p-2 text-zinc-500"><XCircle size={20} /></button>
            </div>

            {isScanning ? (
              <div className="py-12 flex flex-col items-center gap-8">
                <Radio size={56} className="text-cyan-400 animate-pulse" />
                <div className="text-center">
                  <p className="text-sm font-black uppercase tracking-[0.4em] text-cyan-400">Searching...</p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {scanError && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 text-red-400">
                    <AlertCircle size={16} className="shrink-0" />
                    <p className="text-[10px] font-mono">{scanError}</p>
                  </div>
                )}
                
                <button onClick={handleLinkHardware} className="w-full p-8 bg-cyan-500/10 border border-cyan-500/20 rounded-[2.5rem] flex flex-col items-center gap-4 hover:bg-cyan-500/20 transition-all">
                  <div className="p-5 bg-cyan-500 rounded-3xl text-black shadow-[0_0_20px_rgba(34,211,238,0.4)]">
                    <Zap size={32} />
                  </div>
                  <span className="block font-black uppercase text-xs tracking-[0.2em] text-cyan-400">Initialize Link</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 p-4 space-y-6 overflow-y-auto custom-scrollbar">
        {activeTab === AppTab.DASHBOARD && (
          <div className="animate-in fade-in duration-500">
            {/* GRID LAYOUT LIKT ALDLDROID */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {currentAdx?.gauges.map((g, idx) => (
                <div key={g.id} className={`${currentTheme.card} border rounded-[2.5rem] p-4 flex flex-col relative group overflow-hidden`}>
                  <button onClick={() => setEditingGaugeIdx(idx)} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-1.5 bg-white/5 rounded-full text-white/30 z-20">
                    <Edit3 size={12} />
                  </button>
                  <CircularGauge 
                    value={telemetry[g.field] || 0}
                    min={g.min}
                    max={g.max}
                    label={g.label}
                    unit={g.unit}
                    color={currentTheme.gauge}
                  />
                </div>
              ))}
            </div>
            
            <div className="p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-[2.5rem]">
                {engineAnalysis ? (
                    <div className="text-[11px] text-indigo-200/70 font-mono leading-relaxed animate-in slide-in-from-bottom-2">
                        <p>{engineAnalysis}</p>
                        <button onClick={() => setEngineAnalysis(null)} className="mt-3 text-[9px] font-black uppercase text-indigo-400 tracking-widest">Clear Analysis</button>
                    </div>
                ) : (
                    <button onClick={async () => { setIsAnalyzing(true); const res = await analyzeEngineState(telemetry); setEngineAnalysis(res); setIsAnalyzing(false); }} disabled={isAnalyzing || !isConnected}
                        className="w-full flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400">
                        <Sparkles size={14} className={isAnalyzing ? 'animate-spin' : ''} />
                        {isAnalyzing ? 'Analyzing Stream...' : 'Run AI Diagnosis'}
                    </button>
                )}
            </div>
          </div>
        )}

        {activeTab === AppTab.DATA_LIST && (
           <div className="space-y-1 bg-black/20 rounded-[2rem] overflow-hidden border border-white/5">
              {currentAdx?.parameters.map(p => (
                <div key={p.id} className="px-6 py-4 flex justify-between items-center border-b border-white/5 last:border-0 hover:bg-white/5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">{p.title}</span>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-xl font-black font-mono tracking-tighter ${currentTheme.text}`}>{telemetry[p.id] !== undefined ? Number(telemetry[p.id]).toFixed(2) : '---'}</span>
                        <span className="text-[8px] opacity-10 font-bold w-6">{p.units}</span>
                    </div>
                </div>
              ))}
           </div>
        )}

        {activeTab === AppTab.DTC_LIST && (
          <div className="space-y-6">
            <div className="p-8 bg-zinc-900/50 border border-white/5 rounded-[2.5rem] flex flex-col items-center text-center">
              <ShieldAlert size={48} className="text-zinc-700 mb-4" />
              <h3 className="text-sm font-black uppercase tracking-widest">Fault Monitor</h3>
              <p className="text-[10px] text-zinc-500 mt-2">Checking ECM for stored error codes...</p>
            </div>
            <div className="p-6 bg-black/40 border border-white/5 rounded-[2.5rem] space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40 ml-2">Manual Lookup</h3>
              <div className="flex gap-2">
                <input type="text" value={manualDtc} onChange={(e) => setManualDtc(e.target.value)} placeholder="e.g. Code 32" className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm font-mono outline-none" />
                <button onClick={handleExplainDtc} className="bg-cyan-500/20 text-cyan-400 p-4 rounded-2xl">
                  {isExplainingDtc ? <Sparkles size={18} className="animate-spin" /> : <Search size={18} />}
                </button>
              </div>
              {dtcExplanation && (
                <div className="p-5 bg-cyan-500/5 border border-cyan-500/10 rounded-2xl">
                  <p className="text-[11px] leading-relaxed text-zinc-300 font-mono">{dtcExplanation}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === AppTab.CONNECTION && (
            <div className="space-y-8">
                <section className="space-y-4">
                    <h3 className="text-[9px] font-black opacity-30 uppercase tracking-[0.4em] ml-2">Definition Files</h3>
                    <div className="grid gap-3">
                        {adxLibrary.map(adx => (
                            <button key={adx.id} onClick={() => { setCurrentAdxId(adx.id); setActiveTab(AppTab.DASHBOARD); }}
                                className={`w-full p-6 rounded-3xl border-2 text-left flex items-center justify-between transition-all ${currentAdxId === adx.id ? 'bg-cyan-500/5 border-cyan-500/40' : 'bg-zinc-900/30 border-white/5 opacity-40'}`}>
                                <span className="text-sm font-black uppercase tracking-tight">{adx.name}</span>
                                {currentAdxId === adx.id && <Zap size={18} className="text-cyan-400" />}
                            </button>
                        ))}
                        <label className="w-full py-8 border-2 border-dashed border-white/10 rounded-[2rem] flex flex-col items-center gap-3 cursor-pointer hover:bg-white/5">
                            <Plus size={24} className="text-zinc-600" />
                            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600">Load ADX</span>
                            <input type="file" className="hidden" accept=".adx" onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const text = await file.text();
                                const newAdx = parseADX(text, file.name);
                                setAdxLibrary(prev => [...prev.filter(a => a.name !== newAdx.name), newAdx]);
                                setCurrentAdxId(newAdx.id);
                            }}/>
                        </label>
                    </div>
                </section>
                <section className="space-y-4">
                    <h3 className="text-[9px] font-black opacity-30 uppercase tracking-[0.4em] ml-2">Logging History</h3>
                    <button disabled={logData.length === 0} onClick={exportLogToCSV} className="w-full py-5 bg-zinc-900/50 rounded-3xl border border-white/5 flex items-center justify-center gap-3 text-xs font-bold opacity-40 disabled:opacity-10">
                      <Download size={16} /> Export Last Session
                    </button>
                </section>
            </div>
        )}

        {activeTab === AppTab.THEME_SELECT && (
           <div className="grid gap-4">
              {(['neon', 'carbon', 'retro'] as GaugeTheme[]).map(t => (
                 <button key={t} onClick={() => setTheme(t)} className={`p-8 rounded-[2.5rem] border-4 flex items-center justify-between transition-all ${theme === t ? 'border-white bg-white/5' : 'border-zinc-900 bg-black/40 opacity-40'}`}>
                    <span className="text-xl font-black uppercase tracking-[0.2em]">{t}</span>
                    {theme === t && <CheckCircle2 size={24} />}
                 </button>
              ))}
           </div>
        )}
      </main>

      {/* SENSOR MAPPING */}
      {editingGaugeIdx !== null && (
        <div className="fixed inset-0 z-[200] bg-black/98 backdrop-blur-2xl flex flex-col p-8 animate-in fade-in">
          <div className="flex justify-between items-center mb-10">
            <h2 className="text-xl font-black uppercase tracking-[0.3em]">Select Sensor</h2>
            <button onClick={() => setEditingGaugeIdx(null)} className="p-3 bg-white/5 rounded-full"><XCircle size={24} /></button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
            {currentAdx?.parameters.map(p => (
              <button key={p.id} onClick={() => changeGauge(editingGaugeIdx, p.id)} className="w-full p-5 bg-zinc-900 border border-white/5 rounded-2xl text-left flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-tight">{p.title}</span>
                <ChevronRight size={18} className="opacity-20" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FOOTER NAV */}
      <nav className="fixed bottom-0 left-0 w-full bg-black/90 backdrop-blur-3xl border-t border-white/5 flex justify-around items-center p-5 pb-10 z-[150]">
        <NavBtn active={activeTab === AppTab.DASHBOARD} onClick={() => setActiveTab(AppTab.DASHBOARD)} icon={<Activity />} label="Dash" color={currentTheme.accent} />
        <NavBtn active={activeTab === AppTab.DATA_LIST} onClick={() => setActiveTab(AppTab.DATA_LIST)} icon={<Monitor />} label="List" color={currentTheme.accent} />
        <NavBtn active={activeTab === AppTab.DTC_LIST} onClick={() => setActiveTab(AppTab.DTC_LIST)} icon={<ShieldAlert />} label="Fault" color={currentTheme.accent} />
        <NavBtn active={activeTab === AppTab.THEME_SELECT} onClick={() => setActiveTab(AppTab.THEME_SELECT)} icon={<Layers />} label="Skin" color={currentTheme.accent} />
        <NavBtn active={activeTab === AppTab.CONNECTION} onClick={() => setActiveTab(AppTab.CONNECTION)} icon={<Settings />} label="Setup" color={currentTheme.accent} />
      </nav>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
      `}</style>
    </div>
  );
};

const NavBtn = ({ active, onClick, icon, label, color }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1.5 flex-1 transition-all ${active ? 'opacity-100' : 'opacity-20'}`}>
    <div style={{ color: active ? color : 'white' }}>{React.cloneElement(icon, { size: 22 })}</div>
    <span className="text-[8px] font-black uppercase tracking-[0.2em]">{label}</span>
  </button>
);

export default App;
