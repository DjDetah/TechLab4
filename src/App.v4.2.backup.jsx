import React, { useState, useEffect, createContext, useContext, useRef, useMemo } from 'react';
import {
  LayoutDashboard, Plus, Search, User, LogOut, Moon, Sun,
  ChevronLeft, ChevronRight, X, Phone, Mail, MapPin,
  Camera, Save, Trash2, Clock, CheckCircle, AlertTriangle,
  Package, Truck, Wrench, Users, Activity, Settings, Link,
  Download, ExternalLink, Filter, Calendar, MoreVertical, BrainCircuit, LayoutGrid, Minus, PlusCircle, PlayCircle, PauseCircle, Printer, Nfc
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import QRCode from "react-qr-code";

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, getFirestore,
  query, orderBy, where, serverTimestamp, arrayUnion, arrayRemove, deleteDoc, writeBatch
} from "firebase/firestore";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyB6R3IDtiAlHkdrLSEQnjB3xQbxxLX_5wE",
  authDomain: "techlab-ab141.firebaseapp.com",
  projectId: "techlab-ab141",
  storageBucket: "techlab-ab141.firebasestorage.app",
  messagingSenderId: "50599339374",
  appId: "1:50599339374:web:442d7c8eb23bf610638d7f"
};

// Initialize Firebase
let app, db, auth, storage;
try {
  if (firebaseConfig.apiKey.length > 20) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    storage = getStorage(app);
  }
} catch (e) {
  console.warn("Firebase not properly configured.", e);
}

// --- CONSTANTS & TYPES ---

const STATUS_FLOW = {
  'Ingresso': { next: 'Diagnosi', color: 'bg-blue-100 text-blue-800' },
  'Diagnosi': { next: 'In Lavorazione', color: 'bg-purple-100 text-purple-800' },
  'In Lavorazione': { next: 'Attesa Parti', color: 'bg-amber-100 text-amber-800' },

  'Staging': { next: 'Riparato', color: 'bg-cyan-100 text-cyan-800' }, // V4.1 Added
  'Attesa Parti': { next: 'In Lavorazione', color: 'bg-orange-100 text-orange-800' },
  'In RMA': { next: 'Rientro RMA', color: 'bg-pink-100 text-pink-800' },
  'Rientro RMA': { next: 'In Lavorazione', color: 'bg-indigo-100 text-indigo-800' },
  'Riparato': { next: 'Spedito', color: 'bg-emerald-100 text-emerald-800' },
  'Spedito': { color: 'bg-gray-100 text-gray-800' }
};

const ALL_STATUSES = Object.keys(STATUS_FLOW);

const INITIAL_SETTINGS = {
  categories: ['Laptop', 'Desktop', 'Server', 'Mobile', 'Tablet'],
  models: ['ThinkPad X1', 'MacBook Pro', 'Dell XPS', 'iPhone 15', 'Galaxy S24'],
  categories: ['Laptop', 'Desktop', 'Server', 'Mobile', 'Tablet'],
  models: ['ThinkPad X1', 'MacBook Pro', 'Dell XPS', 'iPhone 15', 'Galaxy S24'],
  suppliers_inbound: ['TechParts Inc.', 'Global Components', 'ScreenFix'],
  suppliers_outbound: ['Apple Support', 'Dell Service', 'Laboratorio Partner'],
  spareParts: ['Schermo', 'Batteria', 'Tastiera', 'Trackpad', 'Ventola', 'Scheda Madre', 'Altoparlanti', 'Scocca', 'Connettore Ricarica'],
  partCategories: ['General', 'Cavi', 'Elettronica', 'Meccanica', 'Viteria', 'Consumabile'],
  enableLabels: false,
  forceLabelPrint: false,
  enableNFC: false,
  forceNFC: false,
  enableMobileMode: false // V4.2 Mobile Mode is optional/beta
};

// SLA Config moved to state
const AUTO_ASSIGN_RULES = {
  'Laptop': 'Marco (Tech)',
  'Desktop': 'Marco (Tech)',
  'Mobile': 'Luca (Tech)',
  'Tablet': 'Luca (Tech)'
};

class RepairService {
  constructor() {
    this.useFirebase = !!db;
    this.CACHE_KEY = 'techlab_repairs_v2';
  }

  // --- AUTH & USERS ---

  async login(email, password) {
    if (this.useFirebase) return signInWithEmailAndPassword(auth, email, password);
    return { user: { email, uid: 'user-1' } }; // Mock
  }

  async register(email, password) {
    if (this.useFirebase) {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Create user profile
      await setDoc(doc(db, "users", cred.user.uid), {
        email: email,
        role: 'operator', // Default role
        createdAt: serverTimestamp()
      });
      return cred;
    }
    return { user: { email, uid: 'new-user' } };
  }

  async logout() {
    if (this.useFirebase) return signOut(auth);
  }

  async getUserProfile(uid) {
    if (this.useFirebase) {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) return snap.data();

      // Auto-create if missing (migration for existing users)
      const newProfile = { email: auth.currentUser?.email, role: 'operator', createdAt: serverTimestamp() };
      await setDoc(doc(db, "users", uid), newProfile);
      return newProfile;
    }
    return { role: 'manager' }; // Mock admin
  }

  async getAllUsers() {
    if (this.useFirebase) {
      const q = query(collection(db, "users"), orderBy("email"));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    }
    return [{ uid: 'user-1', email: 'mock@user.com', role: 'manager' }];
  }

  async updateUserRole(uid, newRole) {
    if (this.useFirebase) {
      await updateDoc(doc(db, "users", uid), { role: newRole });
    }
  }

  async updateUserProfile(uid, data) {
    if (this.useFirebase) {
      await updateDoc(doc(db, "users", uid), data);
    }
  }

  // --- REPAIRS ---

  async getRepairs() {
    if (this.useFirebase) {
      const q = query(collection(db, "repairs"), orderBy("dateIn", "desc"));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          dateIn: dateToStr(data.dateIn),
          dateStart: dateToStr(data.dateStart),
          dateOut: dateToStr(data.dateOut),
          datePartsMissing: dateToStr(data.datePartsMissing),
          dateResume: dateToStr(data.dateResume),
          dateRmaReturn: dateToStr(data.dateRmaReturn),
          rmaInfo: data.rmaInfo ? {
            ...data.rmaInfo,
            dateSent: dateToStr(data.rmaInfo.dateSent)
          } : null
        };
      });
    }
    const data = localStorage.getItem(this.CACHE_KEY);
    return data ? JSON.parse(data) : [];
  }

  async getRepairById(id) {
    if (this.useFirebase) {
      const repairs = await this.getRepairs();
      return repairs.find(r => r.id === id);
    }
    const repairs = await this.getRepairs();
    return repairs.find(r => r.id === id);
  }

  async addRepair(data) {
    const newRepair = {
      ...data,
      status: 'Ingresso',
      dateIn: new Date().toISOString(), // Fallback for UI immediately
      logs: []
    };
    if (this.useFirebase) {
      const docRef = await addDoc(collection(db, "repairs"), {
        ...newRepair,
        dateIn: serverTimestamp()
      });
      return { id: docRef.id, ...newRepair };
    }
    // LocalStorage logic omitted for brevity in V2
    return newRepair;
  }

  async updateStatus(id, newStatus, extraData = {}) {
    const updates = {
      status: newStatus,
      lastUpdate: serverTimestamp(),
      ...extraData
    };

    if (newStatus === 'In Lavorazione') {
      // If resuming from specific states, track resumption, otherwise it's initial start
      // We can check previous status but here we just update if it's not set or overwrite?
      // Let's assume 'dateStart' is initial. We might want 'dateResume' if coming from a pause.
      // For simplicity: if dateStart exists, this is a resume? No, complex.
      // Let's just update 'dateStart' only if undefined, or track 'dateResume' if we can.
      // Current logic: updates.dateStart = serverTimestamp() overrides it every time.
      // Better:
      // if (!current.dateStart) updates.dateStart = ... (requires get)
      // For now, let's just stick to the requested fields:
      // "data in cui viene ripresa la lavorazione dopo il ricevimento parti" implies a specific field.
    }

    // Explicit requested timestamps
    if (newStatus === 'Attesa Parti') updates.datePartsMissing = serverTimestamp();
    if (newStatus === 'In Lavorazione') {
      // We don't know the previous status here easily without a read.
      // Ideally we'd read first or trust the UI to pass 'resuming' flag.
      // Let's rely on simple overwrites for 'dateResume' if we want to track latest resume.
      updates.dateResume = serverTimestamp();
      // Note: this will update on every "In Lavorazione".
      // To only set it if previously "Attesa Parti", we need the previous state.
      // For V2.1 simplicity: we will overwrite 'dateResume' = NOW whenever status becomes In Lavorazione.
      // Initial start also sets 'dateStart'.
      updates.dateStart = serverTimestamp(); // Keep existing behavior for "Start"
    }
    if (newStatus === 'Rientro RMA') updates.dateRmaReturn = serverTimestamp();
    if (newStatus === 'Riparato' || newStatus === 'Spedito') updates.dateOut = serverTimestamp();

    // Timeline tracking for KPI
    updates.timeline = arrayUnion({ status: newStatus, date: new Date().toISOString() });

    if (this.useFirebase) {
      await updateDoc(doc(db, "repairs", id), updates);
    }
  }

  async updateParts(id, parts) {
    if (this.useFirebase) {
      await updateDoc(doc(db, "repairs", id), { replacedParts: parts });
    }
  }

  async uploadPhoto(repairId, file) {
    if (this.useFirebase) {
      const uploadToBase64 = () => {
        console.warn("Using Base64 Fallback directly...");
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = async () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 800;
              const scaleSize = MAX_WIDTH / img.width;
              canvas.width = MAX_WIDTH;
              canvas.height = img.height * scaleSize;

              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

              // Compress to JPEG 0.7 quality to keep size low for Firestore (< 1MB limit)
              const base64Url = canvas.toDataURL('image/jpeg', 0.7);

              try {
                await updateDoc(doc(db, "repairs", repairId), {
                  photos: arrayUnion(base64Url)
                });
                console.log("Base64 upload success");
                resolve(base64Url);
              } catch (writeErr) {
                console.error("Firestore write failed", writeErr);
                reject(writeErr);
              }
            };
          };
          reader.onerror = error => reject(error);
        });
      };

      // Force fallback on localhost to avoid CORS noise
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return uploadToBase64();
      }

      try {
        // Try Firebase Storage first (Best Practice)
        const storageRef = ref(storage, `repairs/${repairId}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        await updateDoc(doc(db, "repairs", repairId), {
          photos: arrayUnion(url)
        });
        return url;
      } catch (err) {
        console.warn("Storage upload failed. Falling back to Base64 in Firestore.", err);
        return uploadToBase64();
      }
    }
    // LocalStorage fallback mock
    return "https://via.placeholder.com/150";
  }

  async deletePhoto(repairId, photoUrl) {
    if (this.useFirebase) {
      try {
        await updateDoc(doc(db, "repairs", repairId), {
          photos: arrayRemove(photoUrl)
        });
        return true;
      } catch (err) {
        console.error("Error deleting photo:", err);
        throw err;
      }
    }
    return true; // Mock success
  }

  async getSettings() {
    if (this.useFirebase) {
      const docRef = doc(db, "settings", "lists");
      const snap = await getDoc(docRef);
      if (snap.exists()) return { ...INITIAL_SETTINGS, ...snap.data() };

      // Initialize if missing
      await setDoc(docRef, INITIAL_SETTINGS);
      return INITIAL_SETTINGS;
    }
    const saved = localStorage.getItem('techlab_settings');
    return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
  }

  async updateSettings(newSettings) {
    if (this.useFirebase) {
      const docRef = doc(db, "settings", "lists");
      await setDoc(docRef, newSettings, { merge: true });
    } else {
      localStorage.setItem('techlab_settings', JSON.stringify(newSettings));
    }
  }

  // --- ADMIN TOOLS ---
  async resetRepairDatabase() {
    if (!this.useFirebase) {
      localStorage.removeItem(this.CACHE_KEY);
      return;
    }
    // Batch delete (max 500 per batch)
    const q = query(collection(db, "repairs"));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
  }
}

const service = new RepairService();
const AuthContext = createContext(null);
const NavigationContext = createContext(null);

// --- MAIN COMPONENT ---

// --- HELPER: NFC Writer ---
async function writeNFC(repair) {
  if ('NDEFReader' in window) {
    try {
      const ndef = new new window.NDEFReader();
      await ndef.write({
        records: [{ recordType: "url", data: `https://techlab.app/repair/${repair.id}` }] // In real app, this URL opens the app
      });
      alert("NFC Tag Scritto con successo!");
    } catch (error) {
      console.error(error);
      alert("Errore scrittura NFC: " + error);
    }
  } else {
    alert("Web NFC non supportato su questo browser (Usa Chrome su Android).");
  }
}

// --- COMPONENT: PRINT LABEL ---
function PrintLabel() {
  // Determine the active repair to print.
  // Logic: If 'detail' view is open, print that. 
  // If 'new' view just finished, we might need a global 'lastCreatedRepair' or context.
  // For simplicity V4.2: We rely on the fact that when you click Print in Detail View, 'detail' is active.

  // To access the current repair in the print view, we need either Context or to pass props.
  // Since PrintLabel is at root, let's use a specialized Context or just read from DOM (hacky).
  // Better: Helper Hook or just simple conditional rendering INSIDE RepairDetailView?
  // NO, PrintLabel needs to be outside the scrollable area to print correctly on full page.

  // SOLUTION: Use a global Event or Context store for "PrintTarget".
  // SIMPLER FOR PROTOTYPE: We will expect the user to print *from* the view, 
  // and we will use CSS to HIDE everything else and SHOW the content of the ticket.

  // ACTUALLY: Let's make PrintLabel accept a "ticket" prop if we place it inside views. 
  // But placing it at App Root (line 474) means it needs access to data.

  // REVISED STRATEGY: 
  // We will render the label content HIDDEN always. 
  // But populated with what?
  // Let's create a "PrintContext" or just use local state in App if possible.
  // OR simpler: `window.currentRepairToPrint`.

  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    // Listen for custom event "prepare-print"
    const handler = (e) => setTicket(e.detail);
    window.addEventListener('prepare-print', handler);
    return () => window.removeEventListener('prepare-print', handler);
  }, []);

  // Also try to grab from URL or local storage if provided? 
  // For now, relies on buttons dispatching the event.

  if (!ticket) return null;

  return (
    <div id="print-label" className="hidden print:flex flex-col items-center justify-center fixed inset-0 bg-white z-[9999] p-4 text-black text-center">
      {/* 50x30mm Label Style Approximation */}
      <div className="border-4 border-black p-4 rounded-xl w-[300px] h-[180px] flex items-center gap-4">
        <div className="bg-white p-1">
          <QRCode value={ticket.id} size={96} />
        </div>
        <div className="text-left flex-1 overflow-hidden">
          <h1 className="text-2xl font-black leading-none mb-1">{ticket.tag}</h1>
          <p className="text-[10px] font-mono mb-2">{ticket.id}</p>
          <p className="font-bold text-sm leading-tight truncate">{ticket.model.substring(0, 20)}</p>
          <p className="text-[10px] mt-1">{new Date().toLocaleDateString()}</p>
        </div>
      </div>
      <div className="mt-8 text-xs text-gray-400 print:hidden">Prenota Stampa...</div>
    </div>
  );
}
// Note: Dispatch event before window.print()
// We need to update the onClick handlers above to:
// onClick={() => { window.dispatchEvent(new CustomEvent('prepare-print', { detail: repair })); setTimeout(window.print, 100); }}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // Navigation State
  const [view, setView] = useState('table');
  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile drawer
  const [collapsed, setCollapsed] = useState(false); // Desktop sidebar collapse

  useEffect(() => {
    if (auth) {
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (u) {
          let p = await service.getUserProfile(u.uid);
          setUser(u);
          setProfile(p);
        } else {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      });
      return () => unsub();
    } else {
      setLoading(false);
    }
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) setDarkMode(true);
  }, []);

  // SLA Configuration State (Persisted in localStorage)
  const [slaConfig, setSlaConfig] = useState(() => {
    const saved = localStorage.getItem('techlab_sla_config');
    return saved ? JSON.parse(saved) : {
      'Diagnosi': 48, // hours
      'In Lavorazione': 120, // hours (5 days)
      'Attesa Parti': 240 // hours (10 days)
    };
  });

  // Smart Assignment Rules (Persisted)
  const [assignRules, setAssignRules] = useState(() => {
    const saved = localStorage.getItem('techlab_assign_rules');
    return saved ? JSON.parse(saved) : {
      'Laptop': 'Marco (Tech)',
      'Desktop': 'Marco (Tech)',
      'Mobile': 'Luca (Tech)',
      'Tablet': 'Luca (Tech)'
    };
  });

  const updateSLA = (newConfig) => {
    setSlaConfig(newConfig);
    localStorage.setItem('techlab_sla_config', JSON.stringify(newConfig));
  };

  const updateAssignRules = (newRules) => {
    setAssignRules(newRules);
    localStorage.setItem('techlab_assign_rules', JSON.stringify(newRules));
  };

  // Master Data State (Categories, Models, etc.) from DB
  const [masterData, setMasterData] = useState(INITIAL_SETTINGS);

  useEffect(() => {
    service.getSettings().then(setMasterData);
  }, []);

  const updateMasterData = async (newMasterData) => {
    setMasterData(newMasterData);
    await service.updateSettings(newMasterData);
  };

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  if (loading) return <div className="h-screen flex items-center justify-center">Caricamento...</div>;
  if (!user) return <AuthScreen onLogin={() => { }} />;

  return (
    <AuthContext.Provider value={{ user, profile, refreshProfile: async () => setProfile(await service.getUserProfile(user.uid)), logout: () => { service.logout(); } }}>
      <NavigationContext.Provider value={{ view, setView, sidebarOpen, setSidebarOpen, collapsed, setCollapsed }}>
        {view === 'operator' ? (
          <MobileOperatorLayout>
            <OperatorDashboard />
          </MobileOperatorLayout>
        ) : (
          <div className="flex h-screen bg-gray-50 text-gray-900 dark:bg-slate-900 dark:text-gray-100 font-sans transition-colors">
            <Sidebar masterData={masterData} />
            <main className="flex-1 overflow-hidden flex flex-col relative w-full">
              <Header darkMode={darkMode} setDarkMode={setDarkMode} />
              <div className="flex-1 overflow-auto p-4 md:p-6">
                <MainContent
                  slaConfig={slaConfig} updateSLA={updateSLA}
                  assignRules={assignRules} updateAssignRules={updateAssignRules}
                  masterData={masterData} updateMasterData={updateMasterData}
                />
              </div>

              {/* V4.2 Print Label Component (Hidden, Visible on Print) */}
              <PrintLabel />
            </main>
          </div>
        )}
      </NavigationContext.Provider>
    </AuthContext.Provider>
  );
}

// --- AUTH SCREEN ---
function AuthScreen() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      isRegister ? await service.register(email, password) : await service.login(email, password);
    } catch (err) {
      setError("Errore: " + err.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 dark:bg-slate-900 p-4">
      <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-sm border border-gray-100 dark:border-slate-700">
        <h2 className="text-2xl font-bold mb-6 text-center">{isRegister ? 'Registrazione' : 'Accesso'}</h2>
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" placeholder="Email" className="input" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" className="input" value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl">{isRegister ? 'Registrati' : 'Accedi'}</button>
        </form>
        <button onClick={() => setIsRegister(!isRegister)} className="w-full mt-4 text-sm text-indigo-600 hover:underline">
          {isRegister ? 'Hai già un account? Accedi' : 'Crea un account'}
        </button>
      </div>
    </div>
  );
}

// --- APP NAVIGATION ---
function Sidebar({ masterData }) {
  const { logout, profile } = useContext(AuthContext);
  const { view, setView, sidebarOpen, setSidebarOpen, collapsed, setCollapsed } = useContext(NavigationContext);

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-20 md:hidden ${sidebarOpen ? 'block' : 'hidden'}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`fixed md:static inset-y-0 left-0 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col z-30 transition-all duration-300 transform
        ${sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-0 md:translate-x-0'}
        ${collapsed ? 'md:w-20' : 'md:w-64'}
      `}>
        <div className={`p-6 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <div className="flex items-center gap-3 text-indigo-600 font-extrabold text-xl tracking-tight">
              <Wrench className="w-6 h-6" /> TECHLAB
            </div>
          )}
          {collapsed && <Wrench className="w-8 h-8 text-indigo-600" />}

          <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700"><X size={20} /></button>
        </div>

        {/* Desktop Toggle (Sandwich/Chevron) */}
        <div className="hidden md:flex justify-end px-4 mb-4">
          <button onClick={() => setCollapsed(!collapsed)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
            {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-2 md:px-4 space-y-1 mt-0">
          {!collapsed && <h3 className="px-4 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Workspace</h3>}
          <NavLink icon={LayoutDashboard} label="Dashboard" viewName="table" current={view} setView={setView} collapsed={collapsed} />
          {/* V4.2 Inventory */}
          <NavLink icon={Package} label="Magazzino" viewName="inventory" current={view} setView={setView} collapsed={collapsed} />
          {/* V4.2 Mobile Mode (Optional) */}
          {(masterData?.enableMobileMode) && (
            <NavLink icon={LayoutGrid} label="Mobile Mode" viewName="operator" current={view} setView={setView} collapsed={collapsed} />
          )}
          {/* <NavLink icon={Truck} label="Logistica" viewName="logistics" current={view} setView={setView} collapsed={collapsed} /> */}

          {(profile?.role === 'manager' || profile?.role === 'head_tech') && (
            <>
              {!collapsed && <h3 className="px-4 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 mt-6">Admin</h3>}
              <div className={collapsed ? "mt-4 border-t border-gray-100 dark:border-slate-700 pt-4" : ""}>
                <NavLink icon={Users} label="Team" viewName="team" current={view} setView={setView} collapsed={collapsed} />
                <NavLink icon={Activity} label="KPI" viewName="kpi" current={view} setView={setView} collapsed={collapsed} />
                <NavLink icon={Settings} label="Impostazioni" viewName="settings" current={view} setView={setView} collapsed={collapsed} />
              </div>
            </>
          )}
        </nav>
        <div className="p-4 border-t border-gray-200 dark:border-slate-700">
          <button onClick={logout} className={`flex items-center gap-3 text-gray-500 hover:text-red-500 transition-colors w-full px-4 py-2 rounded-lg ${collapsed ? 'justify-center' : ''}`} title="Logout">
            <LogOut size={18} /> {!collapsed && 'Logout'}
          </button>
        </div>
      </aside>
    </>
  );
}

function NavLink({ icon: Icon, label, viewName, current, setView, collapsed }) {
  const isActive = current === viewName;
  return (
    <button
      onClick={() => setView(viewName)}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl font-medium transition-colors
        ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'}
        ${collapsed ? 'justify-center' : ''}
      `}
      title={collapsed ? label : ''}
    >
      <Icon size={20} /> {!collapsed && label}
    </button>
  );
}

function Header({ setDarkMode, darkMode }) {
  const { user, profile } = useContext(AuthContext);
  const { sidebarOpen, setSidebarOpen } = useContext(NavigationContext);

  return (
    <header className="h-16 border-b border-gray-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm flex items-center justify-between px-6 sticky top-0 z-10 w-full">
      <div className="flex items-center gap-4">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-gray-300 md:hidden"
        >
          <MoreVertical className="rotate-90" />
        </button>
        <h1 className="font-bold text-lg text-gray-800 dark:text-white hidden sm:block">Workspace</h1>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500">
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <div className="text-right hidden sm:block">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{profile?.username || user?.email}</p>
          <p className="text-xs text-gray-400 capitalize">{profile?.role || 'Guest'}</p>
        </div>
      </div>
    </header>
  );
}

// --- CONTENT ROUTER ---
const MainContent = ({ slaConfig, updateSLA, assignRules, updateAssignRules, masterData, updateMasterData }) => {
  const { view, setView } = useContext(NavigationContext);
  const [selectedRepair, setSelectedRepair] = useState(null);

  if (view === 'table') return <OperatorTable onAdd={() => setView('new')} onSelect={(r) => { setSelectedRepair(r); setView('detail'); }} slaConfig={slaConfig} masterData={masterData} />;

  // Pass masterData (settings) to views
  if (view === 'new') return <NewRepairForm settings={masterData} onCancel={() => setView('table')} onSuccess={() => setView('table')} assignRules={assignRules} masterData={masterData} />;

  if (view === 'detail') return <RepairDetailView repair={selectedRepair} settings={masterData} onClose={() => { setSelectedRepair(null); setView('table'); }} load={() => { }} masterData={masterData} onUpdateMasterData={updateMasterData} />;

  if (view === 'team') return <TeamManagementView />;
  if (view === 'logistics') return <div className="p-10 text-center text-gray-400">Modulo Logistica in arrivo</div>;
  if (view === 'kpi') return <KPIView />;
  if (view === 'settings') return (
    <SettingsView
      slaConfig={slaConfig} onUpdate={updateSLA}
      assignRules={assignRules} onUpdateRules={updateAssignRules}
      masterData={masterData} onUpdateMasterData={updateMasterData}
    />
  );

  if (view === 'inventory') return <InventoryView masterData={masterData} onUpdateMasterData={updateMasterData} />;

  return null;
};

// --- FEATURES: TEAM ---
function TeamManagementView() {
  const [users, setUsers] = useState([]);
  const { user: currentUser, profile: currentProfile, refreshProfile } = useContext(AuthContext);

  useEffect(() => {
    service.getAllUsers().then(setUsers);
  }, []);

  const handleRoleChange = async (uid, newRole) => {
    await service.updateUserRole(uid, newRole);
    setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    if (uid === currentUser.uid) refreshProfile();
  };

  const handleUsernameChange = async (uid, newUsername) => {
    await service.updateUserProfile(uid, { username: newUsername });
    setUsers(users.map(u => u.uid === uid ? { ...u, username: newUsername } : u));
    if (uid === currentUser.uid) refreshProfile();
  };

  const canEdit = currentProfile?.role === 'manager' || currentProfile?.role === 'head_tech';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-6">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Users /> Gestione Team</h2>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b dark:border-slate-700 text-gray-400">
              <th className="p-3">Utente (Username / Email)</th>
              <th className="p-3">Ruolo Attuale</th>
              <th className="p-3">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.uid} className="border-b dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                <td className="p-3">
                  <div className="font-bold text-gray-800 dark:text-gray-200">
                    {canEdit ? (
                      <input
                        type="text"
                        className="bg-transparent border-b border-dashed border-gray-400 focus:border-indigo-500 outline-none w-full"
                        defaultValue={u.username || ''}
                        placeholder={u.email} // Fallback logic visual
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (u.username || '')) handleUsernameChange(u.uid, val);
                        }}
                      />
                    ) : (
                      u.username || u.email
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="p-3">
                  <UserBadge role={u.role} />
                </td>
                <td className="p-3">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                    disabled={!canEdit || u.uid === currentUser.uid}
                    className="input py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900"
                  >
                    <option value="operator">Tecnico (Operatore)</option>
                    <option value="head_tech">Resp. Operativo</option>
                    <option value="logistics">Resp. Logistico</option>
                    <option value="manager">Manager</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- FEATURES: SETTINGS ---
function SettingsView({ slaConfig, onUpdate, assignRules, onUpdateRules, masterData, onUpdateMasterData }) {
  const { profile } = useContext(AuthContext);
  const [localConfig, setLocalConfig] = useState(slaConfig);
  const [localRules, setLocalRules] = useState(assignRules);
  const [localMaster, setLocalMaster] = useState(masterData || INITIAL_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  // Helper for list management
  const updateList = (key, newList) => {
    setLocalMaster(prev => ({ ...prev, [key]: newList }));
  };

  // Helper for master data updates (e.g., checkboxes)
  const handleMasterDataUpdate = (key, value) => {
    setLocalMaster(prev => ({ ...prev, [key]: value }));
  };

  // V4.1: Dynamic Status List from Global Constant
  const statuses = ALL_STATUSES;
  const categories = localMaster.categories || INITIAL_SETTINGS.categories;


  const handleSave = () => {
    onUpdate(localConfig);
    onUpdateRules(localRules);
    onUpdateMasterData(localMaster);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-xl shadow p-8">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
        <Settings className="text-gray-400" /> Impostazioni & Configurazioni
      </h2>

      <div className="space-y-8">

        {/* SECTION 1: SLA */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><Clock className="text-gray-400" /> Soglie SLA (Ore)</h3>
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg border border-indigo-100 dark:border-indigo-800 mb-4">
            <p className="text-sm text-indigo-800 dark:text-indigo-300">
              Imposta il tempo massimo per ogni stato. Oltre questa soglia, la riparazione verrà segnalata in ritardo.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {statuses.map(status => (
              <div key={status} className="form-group">
                <label className="label">{status}</label>
                <div className="relative">
                  <input
                    type="number"
                    className="input pr-12"
                    value={localConfig[status] || ''}
                    onChange={(e) => setLocalConfig({ ...localConfig, [status]: parseInt(e.target.value) || 0 })}
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">H</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SECTION 2: AUTO ASSIGN - REMOVED IN V4.1 */}

        {/* Labels & NFC Settings (V4.2) */}
        <div className="mb-8 border-t pt-8 dark:border-slate-700">
          <h3 className="text-lg font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2"><Printer size={20} /> Etichette & NFC</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Labels */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700">
              <h4 className="font-bold flex items-center gap-2 mb-3"><Printer size={16} /> Stampa Etichette</h4>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="toggle toggle-primary"
                    checked={localMaster.enableLabels || false}
                    onChange={(e) => handleMasterDataUpdate('enableLabels', e.target.checked)} />
                  <span>Abilita Generazione Etichette</span>
                </label>
                <label className={`flex items-center gap-3 cursor-pointer ${!localMaster.enableLabels && 'opacity-50 pointer-events-none'}`}>
                  <input type="checkbox" className="toggle toggle-warning"
                    checked={localMaster.forceLabelPrint || false}
                    onChange={(e) => handleMasterDataUpdate('forceLabelPrint', e.target.checked)} />
                  <span>Stampa Obbligatoria (Blocca chiusura)</span>
                </label>
              </div>
            </div>
            {/* Mobile Mode Settings (V4.2) */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700 md:col-span-2">
              <h4 className="font-bold flex items-center gap-2 mb-3"><LayoutGrid size={16} /> Mobile Operator Mode (Beta)</h4>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="toggle toggle-primary"
                    checked={localMaster.enableMobileMode || false}
                    onChange={(e) => handleMasterDataUpdate('enableMobileMode', e.target.checked)} />
                  <span>Abilita Interfaccia Mobile (/operator)</span>
                </label>
                <p className="text-xs text-gray-500">
                  Abilita la vista semplificata per operatori e l'uso dello scanner da mobile. Utile per tablet e smartphone.
                </p>
              </div>
            </div>

            {/* NFC */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700">
              <h4 className="font-bold flex items-center gap-2 mb-3"><Nfc size={16} /> Tag NFC</h4>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="toggle toggle-primary"
                    checked={localMaster.enableNFC || false}
                    onChange={(e) => handleMasterDataUpdate('enableNFC', e.target.checked)} />
                  <span>Abilita Scrittura NFC</span>
                </label>
                <label className={`flex items-center gap-3 cursor-pointer ${!localMaster.enableNFC && 'opacity-50 pointer-events-none'}`}>
                  <input type="checkbox" className="toggle toggle-warning"
                    checked={localMaster.forceNFC || false}
                    onChange={(e) => handleMasterDataUpdate('forceNFC', e.target.checked)} />
                  <span>Scrittura Obbligatoria</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: MASTER DATA (Gestione Anagrafiche) */}
        <div className="pt-8 border-t dark:border-slate-700">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Package className="text-gray-400" /> Gestione Anagrafiche</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* GENERIC LISTS: CATEGORIES, SUPPLIERS, CUSTOMERS, OS */}
            {['categories', 'suppliers_inbound', 'suppliers_outbound', 'customers', 'os_list'].map(key => (
              <div key={key} className="space-y-2">
                <label className="label capitalize flex justify-between items-center">
                  {key === 'categories' ? 'Categorie' : key === 'suppliers_inbound' ? 'Fornitori Asset (Ingresso)' : key === 'suppliers_outbound' ? 'Laboratori RMA (Esterni)' : key === 'customers' ? 'Clienti' : 'Sistemi Operativi (OS)'}
                  <span className="text-xs text-gray-400 font-normal">{localMaster[key]?.length || 0} elementi</span>
                </label>
                {profile?.role === 'manager' ? (
                  <div className="relative group">
                    <textarea
                      className="input font-mono text-xs h-40 resize-y"
                      value={(localMaster[key] || []).join('\n')}
                      onChange={(e) => updateList(key, e.target.value.split('\n'))}
                      placeholder={`Lista ${key} (uno per riga)`}
                    />
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white text-xs px-2 py-1 rounded pointer-events-none">Bulk Edit</div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text" className="input" placeholder="Aggiungi..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          updateList(key, [...(localMaster[key] || []), e.target.value.trim()]);
                          e.target.value = '';
                        }
                      }}
                    />
                    <Plus size={20} className="text-gray-400 self-center" />
                  </div>
                )}
              </div>
            ))}

            {/* SPECIAL LIST: MODELS (DEPENDENT ON CATEGORY) */}
            <ModelSettings
              categories={categories}
              models={localMaster.models}
              role={profile?.role}
              onUpdate={(newModels) => setLocalMaster(prev => ({ ...prev, models: newModels }))}
            />

          </div>

          <hr className="my-8 border-gray-200 dark:border-slate-700" />

          {/* Part Category Settings */}
          <h3 className="text-lg font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2"><Package /> Categorie Ricambi</h3>
          <PartCategorySettings
            categories={localMaster.partCategories || []}
            onUpdate={(newCats) => {
              setLocalMaster({ ...localMaster, partCategories: newCats });
              setSaved(false);
            }}
          />

          <hr className="my-8 border-gray-200 dark:border-slate-700" />
        </div>

        {/* SECTION 4: DANGER ZONE (Manager Only) */}
        {profile?.role === 'manager' && (
          <div className="pt-8 border-t border-red-100 dark:border-red-900/30">
            <h3 className="text-lg font-bold text-red-600 mb-4 flex items-center gap-2"><AlertTriangle /> Zona Pericolo</h3>
            <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-xl border border-red-100 dark:border-red-900/30 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-red-800 dark:text-red-400 text-lg">Reset Totale Database</h4>
                <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                  Questa azione cancellerà <strong>TUTTE</strong> le riparazioni salvate.<br />
                  Gli utenti e le impostazioni non verranno eliminati. Azione IRREVERSIBILE.
                </p>
              </div>
              {!resetConfirm ? (
                <button onClick={() => setResetConfirm(true)} className="px-6 py-3 bg-white border border-red-200 hover:bg-red-50 text-red-700 font-bold rounded-lg transition-colors flex items-center gap-2 shadow-sm">
                  <Trash2 size={18} /> Ripulisci DB
                </button>
              ) : (
                <div className="flex flex-col gap-2 items-end">
                  <span className="text-xs font-bold text-red-600 uppercase tracking-wider">Sei sicuro?</span>
                  <div className="flex gap-2">
                    <button onClick={() => setResetConfirm(false)} className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Annulla</button>
                    <button onClick={async () => { await service.resetRepairDatabase(); alert("Database Ripulito con successo!"); setResetConfirm(false); }} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors animate-pulse shadow-lg">
                      CONFERMA CANCELLAZIONE
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pt-8 border-t dark:border-slate-700 flex items-center justify-end gap-4 sticky bottom-0 bg-white dark:bg-slate-800 pb-4 z-10">
          {saved && <span className="text-green-600 font-bold flex items-center gap-2 animate-pulse"><CheckCircle size={18} /> Salvataggio completato!</span>}
          <button onClick={handleSave} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all transform hover:-translate-y-0.5 flex items-center gap-2">
            <Save size={20} /> Salva Configurazioni
          </button>
        </div>
      </div>
    </div>
  );
}

// --- HELPER COMPONENT FOR MODEL SETTINGS ---
function ModelSettings({ categories, models, role, onUpdate }) {
  const [selectedCat, setSelectedCat] = useState(categories?.[0] || '');

  // Effect to ensure selection if categories load later or were empty
  useEffect(() => {
    if (!selectedCat && categories?.length > 0) {
      setSelectedCat(categories[0]);
    }
  }, [categories, selectedCat]);

  // Normalize models to object if it's currently an array (Legacy Migration View)
  const modelsObj = Array.isArray(models) ? { 'Legacy (Non Classificati)': models } : (models || {});

  const updateModelList = (newList) => {
    onUpdate({ ...modelsObj, [selectedCat]: newList });
  };

  const currentList = modelsObj[selectedCat] || [];

  return (
    <div className="space-y-4 border border-indigo-100 dark:border-indigo-900/50 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-2">
          <LayoutGrid size={16} /> Modelli per Categoria
        </label>
        <select
          value={selectedCat}
          onChange={e => setSelectedCat(e.target.value)}
          className="w-full p-2 border-2 border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 rounded-lg text-lg font-medium text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
        >
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
          {Array.isArray(models) && <option value="Legacy (Non Classificati)">⚠️ Legacy (Non Classificati)</option>}
        </select>
      </div>

      {role === 'manager' ? (
        <div className="relative group">
          <textarea
            className="input font-mono text-xs h-40 resize-y"
            value={currentList.join('\n')}
            onChange={(e) => updateModelList(e.target.value.split('\n'))}
            placeholder={`Modelli per ${selectedCat} (uno per riga)`}
          />
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white text-xs px-2 py-1 rounded pointer-events-none">Bulk Edit</div>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="text" className="input" placeholder={`Nuovo modello ${selectedCat}...`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                updateModelList([...currentList, e.target.value.trim()]);
                e.target.value = '';
              }
            }}
          />
          <div className="p-2 bg-gray-100 dark:bg-slate-700 rounded"><Plus size={20} className="text-gray-400" /></div>
        </div>
      )}
      <p className="text-xs text-gray-400">
        Gestione modelli specifica per: <span className="font-bold text-indigo-500">{selectedCat}</span>
      </p>
    </div>
  );
}

// --- HELPER FOR PART CATEGORIES ---
function PartCategorySettings({ categories, onUpdate }) {
  const [newCat, setNewCat] = useState('');

  const addCat = () => {
    if (newCat && !categories.includes(newCat)) {
      onUpdate([...categories, newCat]);
      setNewCat('');
    }
  };

  const removeCat = (cat) => {
    onUpdate(categories.filter(c => c !== cat));
  };

  return (
    <div className="space-y-4 border border-indigo-100 dark:border-indigo-900/50 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50">
      <div className="flex gap-2">
        <input
          type="text"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          placeholder="Nuova Categoria Ricambio..."
          className="flex-1 input"
        />
        <button onClick={addCat} className="btn btn-primary"><Plus size={18} /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(categories || []).map(cat => (
          <span key={cat} className="px-3 py-1 bg-white dark:bg-slate-700 rounded-lg shadow-sm border border-gray-200 dark:border-slate-600 flex items-center gap-2 text-sm">
            {cat}
            <button onClick={() => removeCat(cat)} className="text-red-500 hover:text-red-700"><X size={14} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

// --- FEATURES: REPAIR DETAIL ---
function RepairDetailView({ repair: initialRepair, onClose, load, masterData, onUpdateMasterData }) {
  const { profile } = useContext(AuthContext);
  console.log("RepairDetailView mounted with:", initialRepair);
  // Use local state for optimistic UI updates
  const [repair, setRepair] = useState(initialRepair);
  console.log("RepairDetailView local state:", repair);

  // Sync local state when prop updates (e.g. after parent reload)
  useEffect(() => {
    setRepair(initialRepair);
    setTechNotes(initialRepair.techNotes || '');
  }, [initialRepair]);
  const [loading, setLoading] = useState(false); // No longer loading the initial repair
  const [rmaMode, setRmaMode] = useState(false);
  const [rmaForm, setRmaForm] = useState({ serviceName: '', tracking: '', notes: '' });
  // Staging Helper Hook (Moved up)
  const [selectedOS, setSelectedOS] = useState('');
  // Reassign Helper Hook
  const [isReassigning, setIsReassigning] = useState(false);
  const [userList, setUserList] = useState([]);

  // Local state for tech notes editing
  const [techNotes, setTechNotes] = useState('');

  // Ref for file input - MUST be defined before early returns
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(null);
  // Internal reload to refresh data after actions
  const handleReload = async () => {
    try {
      setLoading(true);
      const fresh = await service.getRepairById(repair.id);
      if (fresh) {
        setRepair(fresh);
        setTechNotes(fresh.techNotes || '');
      }
    } catch (err) {
      console.error("Error reloading repair:", err);
    } finally {
      setLoading(false);
    }
  };

  // Initial load to ensure fresh data
  useEffect(() => { handleReload(); }, []);

  // Sync local state when prop updates (e.g. after parent reload)




  // Load users for reassignment only if needed
  useEffect(() => {
    if (isReassigning) {
      service.getAllUsers().then(users => setUserList(users.filter(u => u.role !== 'manager')));
    }
  }, [isReassigning]);

  const handleStatusUpdate = async (newStatus, extra = {}) => {
    // V4.1 GRAB LOGIC:
    // If starting work ('In Lavorazione') and nobody is assigned, assign to current user.
    if (newStatus === 'In Lavorazione' && !repair.assignedTo) {
      // V4.1: Use Username if available
      extra.assignedTo = profile?.username || profile?.name || profile?.email || 'Tecnico';
    }

    await service.updateStatus(repair.id, newStatus, extra);
    setRmaMode(false);
    handleReload();
  };

  const saveTechNotes = async () => {
    await service.updateStatus(repair.id, repair.status, { techNotes });
    // Optional: toast notification
  };

  const togglePriority = async () => {
    await service.updateStatus(repair.id, repair.status, { priorityClaim: !repair.priorityClaim });
    handleReload();
  };

  if (loading) return <div>Caricamento...</div>;
  if (!repair) return <div>Riparazione non trovata.</div>;

  const steps = ['Ingresso', 'Diagnosi', 'In Lavorazione', 'Staging', 'Attesa Parti', repair.status === 'In RMA' || repair.status === 'Rientro RMA' ? 'In RMA' : null, 'Riparato', 'Spedito'].filter(Boolean);
  const currentIdx = steps.indexOf(repair.status === 'Rientro RMA' ? 'In RMA' : repair.status);

  const submitRMA = () => {
    handleStatusUpdate('In RMA', { rmaInfo: { ...rmaForm, dateSent: new Date().toISOString() } });
  };

  const canEditPriority = profile?.role === 'manager' || profile?.role === 'logistics';

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Optimistic UI or Loading state could be added here
    const url = await service.uploadPhoto(repair.id, file);
    setRepair(prev => ({ ...prev, photos: [...(prev.photos || []), url] }));
  };

  // Prepare OS List
  const osList = masterData?.os_list || ['Windows 10', 'Windows 11', 'macOS', 'Linux Ubuntu', 'Android', 'iOS'];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden animate-fade-in">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUpload}
        className="hidden"
        accept="image/*"
      />

      {/* Header */}
      <div className="p-6 border-b border-gray-200 dark:border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50 dark:bg-slate-700/20">
        <div className="flex items-center gap-4 w-full">
          <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full shrink-0">
            <ChevronLeft size={24} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold flex flex-wrap items-center gap-2 md:gap-3 break-words">
              <span className="truncate">{repair.model}</span>
              <Badge status={repair.status} />
              {repair.priorityClaim && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded border border-red-200 animate-pulse">URGENTE</span>}
            </h1>
            <p className="text-sm text-gray-500 font-mono flex flex-wrap gap-2 md:gap-4 mt-1">
              <span>ID: {repair.id}</span>
              {repair.tag && <span className="text-indigo-600 font-bold">TAG: {repair.tag}</span>}
              <span className="hidden md:inline">{repair.category}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          {/* V4.2 NFC Button */}
          {masterData?.enableNFC && (
            <button onClick={() => writeNFC(repair)} className="flex justify-center items-center gap-2 px-3 py-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg shadow-sm hover:bg-indigo-200 text-sm font-medium" title="Scrivi su Tag NFC">
              <Nfc size={20} />
            </button>
          )}
          {/* V4.2 Print Label Button */}
          {masterData?.enableLabels && (
            <button onClick={() => { window.dispatchEvent(new CustomEvent('prepare-print', { detail: repair })); setTimeout(() => window.print(), 100); }} className="flex justify-center items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg shadow-sm hover:bg-slate-200 text-sm font-medium" title="Stampa Etichetta">
              <Printer size={20} />
            </button>
          )}
          <button onClick={() => fileInputRef.current?.click()} className="flex justify-center items-center gap-2 px-3 py-2 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg shadow-sm hover:bg-gray-50 text-sm font-medium" title="Salva Foto">
            <Camera size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 md:space-y-8">
        {/* Timeline Visual (Desktop Only) */}
        <div className="hidden md:flex items-center justify-between px-10 relative">
          <div className="absolute left-10 right-10 top-1/2 h-1 bg-gray-200 dark:bg-slate-700 -z-0" />
          {steps.map((step, idx) => (
            <div key={step} className="relative z-10 flex flex-col items-center gap-2 bg-white dark:bg-slate-800 p-2">
              <div className={`w-4 h-4 rounded-full ${repair.status === step ? 'bg-indigo-600 ring-4 ring-indigo-200' : 'bg-gray-300'}`} />
              <span className="text-xs font-bold text-gray-500">{step}</span>
            </div>
          ))}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-6">
            {/* Dates - Dynamic Sorted Timeline */}
            <div className="card p-4 bg-gray-50 dark:bg-slate-700/30 rounded-xl">
              <h3 className="text-xs font-bold uppercase text-gray-400 mb-4">Timeline</h3>
              {(() => {
                const events = [
                  { label: "Ingresso", date: repair.dateIn },
                  { label: "Inizio Lavorazione", date: repair.dateStart },
                  { label: "Attesa Parti", date: repair.datePartsMissing, highlight: true },
                  { label: "Ripresa Lavorazione", date: repair.dateResume },
                  { label: "Uscita", date: repair.dateOut },
                ];
                if (repair.rmaInfo) {
                  events.push({ label: "Spedito RMA", date: repair.rmaInfo.dateSent, highlight: true, sub: `Presso: ${repair.rmaInfo.serviceName}` });
                }
                if (repair.dateRmaReturn) {
                  events.push({ label: "Rientro RMA", date: repair.dateRmaReturn });
                }
                // V4.1 Staging
                if (repair.staging && repair.staging.completed) {
                  events.push({ label: "Staging OS", date: repair.staging.date, highlight: true, sub: `OS: ${repair.staging.os}` });
                }
                // V4.1: Assignment History
                if (repair.assignmentHistory) {
                  repair.assignmentHistory.forEach(h => {
                    events.push({ label: `Assegnato a ${h.assignedTo}`, date: h.date, sub: `da ${h.by || 'Sistema'}` });
                  });
                }
                const sorted = events
                  .filter(e => e.date && !isNaN(new Date(e.date).getTime()))
                  .sort((a, b) => new Date(a.date) - new Date(b.date));

                if (sorted.length === 0) return <p className="text-sm text-gray-400">Nessuna data registrata.</p>;

                return sorted.map((e, i) => (
                  <div key={i} className="flex flex-col mb-3 last:mb-0">
                    <DateRow label={e.label} date={e.date} highlight={e.highlight} />
                    {e.sub && <span className="text-xs text-gray-500 text-right">{e.sub}</span>}
                  </div>
                ));
              })()}
            </div>

            {/* Customer Notes */}
            <div className="card p-4 border border-gray-100 dark:border-slate-700 rounded-xl">
              <h3 className="text-xs font-bold uppercase text-gray-400 mb-2">Note Ingresso</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 italic">"{repair.notes || 'Nessuna nota inserita.'}"</p>
            </div>

            {/* SPARE PARTS MONITOR (V4.2 Linked to Inventory) */}
            {['In Lavorazione', 'Attesa Parti', 'Riparato', 'Spedito'].includes(repair.status) && (
              <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-xl">
                <h3 className="text-xs font-bold uppercase text-indigo-800 dark:text-indigo-300 mb-3 flex items-center gap-2">
                  <Wrench size={14} /> Parti Sostituite
                </h3>
                {(!masterData?.inventory || masterData.inventory.length === 0) ? (
                  <p className="text-xs text-gray-400">Nessun ricambio in magazzino.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Inventory List Filtered by Compatibility */}
                    {(masterData?.inventory || [])
                      .filter(p => {
                        // Compatibility Logic
                        // 1. If part has NO compatibleAssetCategory, it is global/universal (or legacy) -> Show it
                        if (!p.compatibleAssetCategory) return true;
                        // 2. If part HAS compatibleAssetCategory, it must match repair.category
                        if (p.compatibleAssetCategory !== repair.category) return false;
                        // 3. If part HAS compatibleModels (not empty), repair.model must be in it
                        if (p.compatibleModels && p.compatibleModels.length > 0 && !p.compatibleModels.includes('Generic')) {
                          return p.compatibleModels.includes(repair.model);
                        }
                        return true;
                      })
                      .map(part => {
                        const usedParts = repair.replacedParts || [];
                        const isUsed = usedParts.includes(part.name);
                        return (
                          <div key={part.name} className="flex items-center justify-between p-3 border border-gray-200 dark:border-slate-700 rounded-lg">
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isUsed}
                                onChange={async (e) => {
                                  const checked = e.target.checked;
                                  let newUsed = checked
                                    ? [...usedParts, part.name]
                                    : usedParts.filter(p => p !== part.name);

                                  // Update Repair
                                  const newRepair = { ...repair, replacedParts: newUsed };
                                  setRepair(newRepair);
                                  await service.updateStatus(repair.id, repair.status, { replacedParts: newUsed });

                                  // Update Inventory Stock
                                  const delta = checked ? -1 : 1; // If checked, quantity decreases; if unchecked, quantity increases
                                  const newInv = masterData.inventory.map(p => {
                                    if (p.id === part.id) { // Use part.id for unique identification
                                      return { ...p, quantity: Math.max(0, parseInt(p.quantity) + delta) };
                                    }
                                    return p;
                                  });
                                  onUpdateMasterData({ ...masterData, inventory: newInv });

                                  handleReload(); // Reload repair
                                }}
                                className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                                disabled={!isUsed && part.quantity <= 0} // Disable if not used and quantity is 0
                              />
                              <div>
                                <div className="font-bold text-gray-800 dark:text-gray-200">{part.name}</div>
                                <div className="text-xs text-gray-500">Disp: {part.quantity} (Min: {part.min_quantity})</div>
                                <div className="text-xs text-gray-400 capitalize">{part.category} - {part.compatibleAssetCategory ? `(${part.compatibleAssetCategory})` : 'Univ.'}</div>
                              </div>
                            </div>
                            {/* Badge Stock */}
                            {part.quantity <= part.min_quantity && (
                              <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded">Low Stock</span>
                            )}
                          </div>
                        );
                      })}</div>
                )}
              </div>
            )}

            {/* Priority Toggle for Logistics/Manager */}
            {canEditPriority && (
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-200 dark:border-orange-800">
                <h3 className="text-xs font-bold uppercase text-orange-800 dark:text-orange-300 mb-2">Gestione Priorità</h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={repair.priorityClaim || false} onChange={togglePriority} className="w-5 h-5 text-red-600 rounded" />
                  <span className="font-bold text-sm text-gray-700 dark:text-gray-200">Segnala come URGENTE</span>
                </label>
              </div>
            )}

            {/* Photo Gallery */}
            <div className="card p-4 border border-gray-100 dark:border-slate-700 rounded-xl">
              <h3 className="text-xs font-bold uppercase text-gray-400 mb-2">Galleria Fotografica</h3>
              <div className="grid grid-cols-2 gap-2">
                {repair.photos?.length > 0 ? repair.photos.map((url, i) => (
                  <div key={i} className="relative group">
                    <button onClick={() => setViewPhoto(url)} className="block w-full aspect-square bg-gray-100 rounded-lg overflow-hidden border dark:border-slate-600 hover:opacity-90 transition-opacity">
                      <img src={url} alt={`Foto ${i}`} className="w-full h-full object-cover" />
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm('Eliminare questa foto?')) {
                          await service.deletePhoto(repair.id, url);
                          // Update local state to remove photo without reloading/navigating
                          setRepair(prev => ({
                            ...prev,
                            photos: prev.photos.filter(p => p !== url)
                          }));
                          alert("Foto eliminata.");
                        }
                      }}
                      className="absolute top-1 right-1 p-1 bg-red-600/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Elimina foto"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )) : (
                  <div className="col-span-2 text-center py-6 text-gray-400 bg-gray-50 dark:bg-slate-900 rounded border border-dashed dark:border-slate-700">
                    <p className="text-xs">Nessuna foto allegata</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-2 space-y-6">
            <div className="card p-6 border rounded-xl bg-white dark:bg-slate-800">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Wrench size={18} /> Dettagli Intervento</h3>

              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mt-1">
                <span className="flex items-center gap-1"><Package size={14} /> {repair.category}</span>
                <span>•</span>
                <span className="flex items-center gap-1"><User size={14} /> {repair.customer || 'Cliente Generico'}</span>
                <span>•</span>
                {repair.status !== 'Diagnosi' && (
                  <span
                    className={`flex items-center gap-1 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 ${(profile?.role === 'manager' || profile?.role === 'head_tech') ? 'cursor-pointer hover:bg-indigo-100 text-indigo-700' : 'text-indigo-600'
                      }`}
                    onClick={() => {
                      if (profile?.role === 'manager' || profile?.role === 'head_tech') {
                        setIsReassigning(true);
                      }
                    }}
                    title={(profile?.role === 'manager' || profile?.role === 'head_tech') ? "Clicca per riassegnare" : "Assegnatario"}
                  >
                    <BrainCircuit size={14} /> {repair.assignedTo || 'Non Assegnato'}
                  </span>
                )}
              </div>
            </div>
            <div className="mb-6">
              <label className="label text-xs uppercase font-bold text-gray-400">Guasto Dichiarato (Cliente)</label>
              <div className="p-3 bg-gray-50 dark:bg-slate-900 rounded-lg text-gray-700 dark:text-gray-300 font-medium">
                {repair.faultDeclared}
              </div>
            </div>

            <div className="mb-6">
              <label className="label text-xs uppercase font-bold text-gray-400 flex justify-between">
                Guasto Riscontrato / Note Tecniche
                <span className="text-indigo-600 cursor-pointer hover:underline" onClick={saveTechNotes}>Salva Note</span>
              </label>
              <textarea
                className="input w-full min-h-[100px] mt-1 font-mono text-sm"
                placeholder="Descrivi l'intervento effettuato, codici ricambi, o diagnosi tecnica..."
                value={techNotes}
                onChange={(e) => setTechNotes(e.target.value)}
                onBlur={saveTechNotes}
              />
            </div>

            {/* ACTIONS */}
            <div className="grid grid-cols-2 gap-4 border-t pt-6 dark:border-slate-700">
              {repair.status === 'Ingresso' && <ActionButton label="Avvia Diagnosi" onClick={() => handleStatusUpdate('Diagnosi')} primary />}
              {repair.status === 'Diagnosi' && <ActionButton label="Inizia Lavorazione" onClick={() => handleStatusUpdate('In Lavorazione')} primary />}

              {repair.status === 'In Lavorazione' && (
                <>
                  <ActionButton label="Avvia Staging / OS" onClick={() => handleStatusUpdate('Staging')} className="border-indigo-200 bg-indigo-50 text-indigo-700" />
                  <ActionButton label="Pezzi di Ricambio" onClick={() => handleStatusUpdate('Attesa Parti')} />
                  <ActionButton label="Riparazione Completata" onClick={() => handleStatusUpdate('Riparato')} primary className="col-span-2" />
                  <ActionButton label="Spedisci a Service Esterno (RMA)" onClick={() => setRmaMode(true)} className="col-span-2 border-orange-500 text-orange-600" />
                </>
              )}

              {repair.status === 'Staging' && (
                <div className="col-span-2 bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-200 dark:border-indigo-800">
                  <h4 className="font-bold text-indigo-800 dark:text-indigo-300 mb-3 flex items-center gap-2">
                    <LayoutGrid size={18} /> Installazione Sistema Operativo
                  </h4>
                  <div className="flex gap-4 items-end">
                    <div className="flex-1">
                      <label className="label text-xs">Seleziona OS</label>
                      <select
                        className="input"
                        value={selectedOS}
                        onChange={e => setSelectedOS(e.target.value)}
                      >
                        <option value="">Seleziona...</option>
                        {osList.map(os => <option key={os} value={os}>{os}</option>)}
                      </select>
                    </div>
                    <button
                      disabled={!selectedOS}
                      onClick={async () => {
                        await handleStatusUpdate('Riparato', {
                          staging: { os: selectedOS, date: new Date().toISOString(), completed: true },
                          techNotes: (techNotes + `\n[Staging] Installato OS: ${selectedOS}`).trim()
                        });
                      }}
                      className="px-6 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Conferma & Chiudi Riparazione
                    </button>
                  </div>
                </div>
              )}

              {repair.status === 'Attesa Parti' && (
                <ActionButton label="Riprendi Lavorazione" onClick={() => handleStatusUpdate('In Lavorazione')} primary className="col-span-2" />
              )}
              {repair.status === 'In RMA' && <ActionButton label="Registra Rientro da RMA" onClick={() => handleStatusUpdate('Rientro RMA')} primary />}
              {repair.status === 'Rientro RMA' && <ActionButton label="Riprendi Lavorazione" onClick={() => handleStatusUpdate('In Lavorazione')} />}
              {repair.status === 'Riparato' && canEditPriority && <ActionButton label="Spedisci al Cliente" onClick={() => handleStatusUpdate('Spedito')} primary />}
            </div>
          </div>
        </div>
      </div>


      {/* PHOTO PREVIEW MODAL */}
      {
        viewPhoto && (
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-fade-in" onClick={() => setViewPhoto(null)}>
            <button className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full" onClick={() => setViewPhoto(null)}><X size={32} /></button>
            <img src={viewPhoto} className="max-w-full max-h-full object-contain rounded shadow-2xl" />
          </div>
        )
      }

      {/* REASSIGN MODAL (V4.1) */}
      {
        isReassigning && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl max-w-sm w-full shadow-2xl animate-fade-in-up">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Users /> Riassegna Lavorazione</h3>
              <div className="space-y-4">
                <div>
                  <label className="label">Seleziona Nuovo Tecnico</label>
                  <select
                    className="input"
                    onChange={async (e) => {
                      if (!e.target.value) return;
                      if (confirm(`Confermi riassegnazione a ${e.target.value}?`)) {
                        await handleStatusUpdate(repair.status, {
                          assignedTo: e.target.value,
                          assignmentHistory: [
                            ...(repair.assignmentHistory || []),
                            { assignedTo: e.target.value, date: new Date().toISOString(), by: profile.username || profile.email }
                          ]
                        });
                        setIsReassigning(false);
                        load();
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>Seleziona...</option>
                    {userList.map(u => (
                      <option key={u.uid} value={u.username || u.email}>{u.username || u.email} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <button onClick={() => setIsReassigning(false)} className="w-full py-2 border rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">Annulla</button>
              </div>
            </div>
          </div>
        )
      }

      {/* RMA MODAL */}
      {
        rmaMode && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl max-w-md w-full shadow-2xl animate-fade-in-up">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><ExternalLink /> Gestione RMA Esterno</h3>
              <div className="space-y-4">
                <div>
                  <label className="label">Laboratorio Esterno</label>
                  <select className="input" value={rmaForm.serviceName} onChange={e => setRmaForm({ ...rmaForm, serviceName: e.target.value })}>
                    <option value="">Seleziona...</option>
                    {(masterData?.suppliers_outbound || ['Apple Support', 'Dell Service', 'Laboratorio Partner']).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Codice Tracking / RMA</label>
                  <input type="text" className="input" placeholder="ES. RMA-2025-998" value={rmaForm.tracking} onChange={e => setRmaForm({ ...rmaForm, tracking: e.target.value })} />
                </div>
                <div>
                  <label className="label">Note Spedizione</label>
                  <textarea className="input" rows={2} value={rmaForm.notes} onChange={e => setRmaForm({ ...rmaForm, notes: e.target.value })}></textarea>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setRmaMode(false)} className="flex-1 py-2 border rounded-lg hover:bg-gray-100">Annulla</button>
                  <button onClick={submitRMA} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold">Conferma Spedizione</button>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

// Helpers...
function DateRow({ label, date, highlight }) {
  if (!date) return null;
  return <div className={`flex justify-between text-sm ${highlight ? 'text-indigo-600 font-bold' : 'text-gray-600 dark:text-gray-400'}`}><span>{label}</span><span>{new Date(date).toLocaleDateString()}</span></div>;
}
function ActionButton({ label, onClick, primary, className }) {
  return <button onClick={onClick} className={`py-3 rounded-xl font-bold transition-all ${primary ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'} ${className}`}>{label}</button>;
}
function UserBadge({ role }) {
  const labels = {
    manager: 'Manager',
    head_tech: 'Resp. Operativo',
    logistics: 'Resp. Logistico',
    tech: 'Tecnico'
  };
  return <span className="capitalize">{labels[role] || role}</span>;
}

// Helpers for date
const dateToStr = (d) => d?.toDate?.()?.toISOString() || d;
const Badge = ({ status }) => {
  const config = STATUS_FLOW[status] || STATUS_FLOW['Ingresso'];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}>{status}</span>;
}

const checkSLA = (repair, config) => {
  if (!config) return false;
  const hours = config[repair.status];
  if (!hours || hours <= 0) return false;

  const limit = hours * 60 * 60 * 1000;

  // Use last timeline entry or lastUpdate
  let startTime = repair.lastUpdate ? new Date(repair.lastUpdate.toDate ? repair.lastUpdate.toDate() : repair.lastUpdate).getTime() : 0;

  if (repair.timeline && repair.timeline.length > 0) {
    const entry = [...repair.timeline].reverse().find(e => e.status === repair.status);
    if (entry) startTime = new Date(entry.date).getTime();
  }

  const elapsed = new Date().getTime() - startTime;
  return elapsed > limit;
};

const StatusCard = ({ label, count, variant, icon: Icon, onClick, isActive }) => {
  const colors = {
    blue: "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300",
    indigo: "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300",
    orange: "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300",
    emerald: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    red: "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300",
    gray: "bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300"
  };
  const colorClass = colors[variant] || colors.blue;

  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-slate-800 p-4 rounded-xl border shadow-sm flex items-center justify-between cursor-pointer transition-all hover:shadow-md active:scale-95
        ${isActive ? 'ring-2 ring-indigo-500 border-indigo-500 dark:border-indigo-400' : 'border-gray-200 dark:border-slate-700'}
      `}
    >
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{count}</p>
      </div>
      <div className={`p-3 rounded-lg ${colorClass}`}>
        <Icon size={24} />
      </div>
    </div>
  );
};

// --- FEATURES: DATA TABLE (Optimized for High Volume) ---

function OperatorTable({ onAdd, onSelect, slaConfig }) {
  const [repairs, setRepairs] = useState([]);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(null); // New: Filter by status card
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const data = await service.getRepairs();
    setRepairs(data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const filtered = repairs.filter(r => {
    // 1. Status Filter (Card Click)
    if (statusFilter) {
      if (statusFilter === 'URGENT') {
        if (!r.priorityClaim) return false;
      } else if (Array.isArray(statusFilter)) {
        if (!statusFilter.includes(r.status)) return false;
      } else {
        if (r.status !== statusFilter) return false;
      }
    }

    // 2. Search Text
    const term = filter.toLowerCase();
    if (!term) return true;
    return (
      (r.serial?.toLowerCase() || '').includes(term) ||
      (r.model?.toLowerCase() || '').includes(term) ||
      (r.id?.toLowerCase() || '').includes(term) ||
      (r.tag?.toLowerCase() || '').includes(term) ||
      (r.category?.toLowerCase() || '').includes(term) ||
      (r.status?.toLowerCase() || '').includes(term) ||
      (r.faultDeclared?.toLowerCase() || '').includes(term)
    );
  });

  // KPI Calculations
  const stats = {
    total: repairs.length,
    ingresso: repairs.filter(r => r.status === 'Ingresso').length,
    working: repairs.filter(r => r.status === 'In Lavorazione' || r.status === 'Diagnosi').length,
    parts: repairs.filter(r => r.status === 'Attesa Parti').length,
    completed: repairs.filter(r => r.status === 'Riparato').length,
    shipped: repairs.filter(r => r.status === 'Spedito').length,
    urgent: repairs.filter(r => r.priorityClaim).length
  };

  return (
    <div className="flex flex-col h-full space-y-4">

      {/* KPI CARDS (V3 Feature) */}
      {/* KPI CARDS (V3 Feature) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatusCard
          label="In Entrata"
          count={stats.ingresso}
          variant="blue"
          icon={Package}
          isActive={statusFilter === 'Ingresso'}
          onClick={() => setStatusFilter(statusFilter === 'Ingresso' ? null : 'Ingresso')}
        />
        <StatusCard
          label="In Corso"
          count={stats.working}
          variant="indigo"
          icon={Wrench}
          isActive={Array.isArray(statusFilter) && statusFilter.includes('In Lavorazione')}
          onClick={() => setStatusFilter(Array.isArray(statusFilter) ? null : ['In Lavorazione', 'Diagnosi'])}
        />
        <StatusCard
          label="Attesa Parti"
          count={stats.parts}
          variant="orange"
          icon={Clock}
          isActive={statusFilter === 'Attesa Parti'}
          onClick={() => setStatusFilter(statusFilter === 'Attesa Parti' ? null : 'Attesa Parti')}
        />
        <StatusCard
          label="Riparati"
          count={stats.completed}
          variant="emerald"
          icon={CheckCircle}
          isActive={statusFilter === 'Riparato'}
          onClick={() => setStatusFilter(statusFilter === 'Riparato' ? null : 'Riparato')}
        />
        <StatusCard
          label="Urgenti"
          count={stats.urgent}
          variant="red"
          icon={AlertTriangle}
          isActive={statusFilter === 'URGENT'}
          onClick={() => setStatusFilter(statusFilter === 'URGENT' ? null : 'URGENT')}
        />
        <StatusCard
          label="Spediti"
          count={stats.shipped}
          variant="gray"
          icon={Truck}
          isActive={statusFilter === 'Spedito'}
          onClick={() => setStatusFilter(statusFilter === 'Spedito' ? null : 'Spedito')}
        />
      </div>

      {/* ACTION BAR */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
        <div className="relative max-w-md w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Cerca per seriale, modello o ID..."
            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={loadData} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Aggiorna">
            <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${loading ? 'bg-indigo-500 animate-pulse' : 'bg-green-500'}`} /> Reload</div>
          </button>
          <button onClick={onAdd} className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg shadow-md shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-colors">
            <Plus size={18} /> Nuovo Ingresso
          </button>
        </div>
      </div>


      {/* DATA TABLE */}
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 dark:bg-slate-900 sticky top-0 z-10 text-xs font-bold text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="p-4 border-b dark:border-slate-700">Tag Asset</th>
                <th className="p-4 border-b dark:border-slate-700">Categoria</th>
                <th className="p-4 border-b dark:border-slate-700">Modello</th>
                <th className="p-4 border-b dark:border-slate-700 w-24">Stato</th>
                <th className="p-4 border-b dark:border-slate-700">Tecnico</th>
                <th className="p-4 border-b dark:border-slate-700">Priorità</th>
                <th className="p-4 border-b dark:border-slate-700">Guasto Dichiarato</th>
                <th className="p-4 border-b dark:border-slate-700 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700 text-sm">
              {filtered.map(row => {
                const isSLAbreached = checkSLA(row, slaConfig);
                return (
                  <tr key={row.id} onClick={() => onSelect(row)} className={`hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors group ${isSLAbreached ? 'bg-red-100 dark:bg-red-900/40 border-l-4 border-red-500' : ''}`}>
                    <td className="p-4 relative">
                      <div className="font-bold text-indigo-600 dark:text-indigo-400">{row.tag || '-'}</div>
                      <div className="text-xs text-gray-400 font-mono mt-0.5">{row.id}</div>
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-300">
                      {row.category}
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-gray-800 dark:text-white">{row.model}</div>
                      <div className="text-xs text-gray-500 font-mono flex items-center gap-1">
                        <Package size={10} /> {row.serial}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Badge status={row.status} />
                        {isSLAbreached && <AlertTriangle size={16} className="text-red-600 animate-pulse" title="Ritardo SLA!" />}
                      </div>
                    </td>
                    <td className="p-4 text-xs font-bold text-indigo-600">
                      {row.assignedTo || '-'}
                    </td>
                    <td className="p-4">
                      {row.priorityClaim && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded border border-red-200 animate-pulse">URGENTE</span>}
                    </td>
                    <td className="p-4">
                      <div className="max-w-[200px] truncate text-gray-600 dark:text-gray-300" title={row.faultDeclared}>{row.faultDeclared}</div>
                    </td>
                    <td className="p-4 text-right">
                      <button className="p-2 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-full text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200">
                        <ChevronRight size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-10 text-center text-gray-400">
              Nessuna riparazione trovata.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- FEATURES: INVENTORY (V4.2) ---
function InventoryView({ masterData, onUpdateMasterData }) {
  const [parts, setParts] = useState(masterData?.inventory || []);
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newPart, setNewPart] = useState({
    name: '', quantity: 0, min_quantity: 5,
    category: masterData?.partCategories?.[0] || 'General',
    compatibleAssetCategory: '',
    compatibleModelsString: ''
  });

  // Sync internal state with props if masterData updates externally
  useEffect(() => {
    if (masterData?.inventory) setParts(masterData.inventory);
  }, [masterData]);

  const updateInventory = (newInv) => {
    setParts(newInv);
    onUpdateMasterData({ ...masterData, inventory: newInv });
  };

  const handleAddPart = () => {
    if (!newPart.name) return;
    const compatibleModels = newPart.compatibleModelsString
      ? newPart.compatibleModelsString.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const partToAdd = {
      ...newPart,
      id: Date.now().toString(),
      compatibleModels
    };
    delete partToAdd.compatibleModelsString; // Cleanup temp field

    const newInv = [...parts, partToAdd];
    updateInventory(newInv);
    setShowAdd(false);
    setNewPart({
      name: '', quantity: 0, min_quantity: 5,
      category: masterData?.partCategories?.[0] || 'General',
      compatibleAssetCategory: '',
      compatibleModelsString: ''
    });
  };

  const updateQty = (id, delta) => {
    const newInv = parts.map(p => p.id === id ? { ...p, quantity: Math.max(0, parseInt(p.quantity) + delta) } : p);
    updateInventory(newInv);
  };

  const exportUsedParts = async () => {
    const repairs = await service.getRepairs();
    const headers = ['ID Lavorazione', 'Nome Ricambio', 'Data Ingresso', 'Modello'];
    const escape = (text) => {
      if (text === null || text === undefined) return '""';
      const str = String(text).replace(/"/g, '""').replace(/\n/g, ' ');
      return `"${str}"`;
    };

    let csvRows = [];
    repairs.forEach(r => {
      if (r.replacedParts && Array.isArray(r.replacedParts)) {
        r.replacedParts.forEach(partName => {
          csvRows.push([
            r.id,
            partName,
            r.dateIn,
            r.model
          ].map(escape).join(';'));
        });
      }
    });

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.map(escape).join(';'), ...csvRows].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `techlab_used_parts_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const handleDelete = (id) => {
    if (confirm("Eliminare questo componente?")) {
      updateInventory(parts.filter(p => p.id !== id));
    }
  };

  const filtered = parts.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800 rounded-xl shadow p-6 animate-fade-in">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Package className="text-indigo-600" /> Gestione Scorte & Ricambi
        </h2>
        <div className="flex gap-2">
          <button onClick={exportUsedParts} className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 rounded-lg flex items-center gap-2 font-medium transition-colors" title="Scarica Report Utilizzo">
            <Download size={18} /> Export
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Aggiungi Parte
          </button>
        </div>
      </div>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          className="input pl-10"
          placeholder="Cerca ricambio..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-100 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900 text-gray-500 uppercase text-xs sticky top-0 z-10">
            <tr>
              <th className="p-3">Nome Ricambio</th>
              <th className="p-3">Categoria</th>
              <th className="p-3 text-center">Quantità</th>
              <th className="p-3 text-center">Soglia Minima</th>
              <th className="p-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(part => {
              const isLow = part.quantity <= part.min_quantity;
              return (
                <tr key={part.id} className={`border-b dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 ${isLow ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                  <td className="p-3 font-medium flex items-center gap-2">
                    {part.name}
                    {isLow && <span className="text-xs bg-red-100 text-red-600 px-1.5 rounded animate-pulse">LOW</span>}
                  </td>
                  <td className="p-3 text-gray-500">{part.category}</td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => updateQty(part.id, -1)} className="p-1 hover:bg-gray-200 rounded text-gray-500"><Minus size={14} /></button>
                      <span className={`font-bold w-12 text-center ${isLow ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}>{part.quantity}</span>
                      <button onClick={() => updateQty(part.id, 1)} className="p-1 hover:bg-gray-200 rounded text-gray-500"><Plus size={14} /></button>
                    </div>
                  </td>
                  <td className="p-3 text-center text-gray-400">{part.min_quantity}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDelete(part.id)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={16} /></button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-gray-400">Nessun ricambio trovato.</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 p-0 rounded-2xl w-full max-w-5xl shadow-2xl animate-fade-in-up overflow-hidden flex flex-col md:flex-row h-[85vh] md:h-auto border border-gray-700/50">
            {/* Left Col: Basic Info */}
            <div className="p-8 md:w-1/2 space-y-5 overflow-y-auto">
              <h3 className="font-bold text-xl mb-1 flex items-center gap-2 text-indigo-700 dark:text-indigo-400"><PlusCircle size={20} /> Nuovo Ricambio</h3>
              <p className="text-xs text-gray-400 mb-4">Inserisci i dettagli del componente nel magazzino.</p>

              <div className="space-y-4">
                <div>
                  <label className="label text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Nome Componente</label>
                  <input type="text" className="input text-base font-bold py-2" autoFocus placeholder="Es. Display OLED 14" value={newPart.name} onChange={e => setNewPart({ ...newPart, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Quantità Iniziale</label>
                    <input type="number" className="input font-mono text-sm py-2" value={newPart.quantity} onChange={e => setNewPart({ ...newPart, quantity: parseInt(e.target.value) })} />
                  </div>
                  <div>
                    <label className="label text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Soglia Alert</label>
                    <input type="number" className="input font-mono text-sm text-red-600 py-2" value={newPart.min_quantity} onChange={e => setNewPart({ ...newPart, min_quantity: parseInt(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <label className="label text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Categoria Ricambio</label>
                  <select className="input text-sm py-2" value={newPart.category} onChange={e => setNewPart({ ...newPart, category: e.target.value })}>
                    {(masterData?.partCategories || ['General']).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Right Col: Compatibility */}
            <div className="p-8 md:w-1/2 bg-gray-50 dark:bg-slate-900/50 border-l border-gray-100 dark:border-slate-700 flex flex-col overflow-y-auto">
              <h4 className="text-base font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2"><Link size={16} /> Compatibilità Asset</h4>

              <div className="space-y-4 flex-1">
                <div>
                  <label className="label text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Categoria Asset Correlata</label>
                  <select className="input text-sm py-2" value={newPart.compatibleAssetCategory} onChange={e => setNewPart({ ...newPart, compatibleAssetCategory: e.target.value, compatibleModelsString: '' })}>
                    <option value="">Universale (Tutti gli asset)</option>
                    {(masterData?.categories || []).map(c => <option key={c}>{c}</option>)}
                  </select>
                  <p className="text-[10px] text-gray-400 mt-1.5">Se "Universale", il ricambio sarà visibile per qualsiasi riparazione.</p>
                </div>

                {newPart.compatibleAssetCategory && (
                  <div>
                    <label className="label text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Modelli Compatibili</label>
                    <div className="border border-gray-200 dark:border-slate-700 rounded-lg max-h-52 overflow-y-auto p-2 bg-white dark:bg-slate-900 shadow-inner">
                      {newPart.compatibleAssetCategory ? (
                        (masterData?.models?.[newPart.compatibleAssetCategory] || []).length > 0 ? (
                          (masterData.models[newPart.compatibleAssetCategory]).map(model => (
                            <label key={model} className="flex items-center gap-2 p-1.5 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer border-b border-transparent hover:border-indigo-100 last:border-0">
                              <input
                                type="checkbox"
                                checked={newPart.compatibleModelsString?.split(',').map(s => s.trim()).includes(model)}
                                onChange={(e) => {
                                  let current = newPart.compatibleModelsString ? newPart.compatibleModelsString.split(',').map(s => s.trim()).filter(Boolean) : [];
                                  if (e.target.checked) {
                                    current.push(model);
                                  } else {
                                    current = current.filter(m => m !== model);
                                  }
                                  setNewPart({ ...newPart, compatibleModelsString: current.join(', ') });
                                }}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                              />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{model}</span>
                            </label>
                          ))
                        ) : <p className="text-xs text-gray-400 p-2 italic text-center">Nessun modello definito.</p>
                      ) : (
                        <p className="text-xs text-gray-400 p-2 italic text-center">Seleziona una Categoria.</p>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5">* Se nessuno selezionato, vale per TUTTI i modelli della categoria.</p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-6 mt-auto">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 font-bold transition-colors">Annulla</button>
                <button onClick={handleAddPart} className="flex-1 py-2.5 text-sm bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none transition-transform active:scale-95">Salva Ricambio</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function NewRepairForm({ onCancel, onSuccess, assignRules, masterData }) {
  const settings = masterData || { categories: [], models: [], suppliers: [], customers: [] }; // settings.models can now be Array OR Object
  const [formData, setFormData] = useState({
    tag: '',
    category: settings.categories?.[0] || 'Laptop',
    model: '',
    serial: '',
    supplier: '',
    customer: '',
    faultDeclared: '',
    notes: '',
    technician: ''
  });

  // Derived state for models based on selected category
  const availableModels = useMemo(() => {
    const rawModels = settings.models || [];
    if (Array.isArray(rawModels)) return rawModels; // Legacy support
    return rawModels[formData.category] || []; // New Structure
  }, [settings.models, formData.category]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // V4.1: Auto Assign Removed. Tickets start as Unassigned.
    // const autoAssignee = assignRules[formData.category] || 'Unassigned';

    await service.addRepair({
      ...formData,
      assignedTo: ''
    });
    onSuccess();
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden animate-fade-in-up">
      <div className="border-b border-gray-200 dark:border-slate-700 p-6 flex justify-between items-center bg-gray-50 dark:bg-slate-900">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-3">
          <div className="bg-indigo-600 text-white p-2 rounded-lg"><Plus size={20} /></div>
          Nuova Registrazione Ingresso
        </h2>
        <button onClick={onCancel} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors">
          <X size={24} className="text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <form id="new-repair-form" onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* LEFT COLUMN: ASSET & CUSTOMER */}
          <div className="space-y-8">
            {/* 1. ASSET INFO */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest border-b pb-2 mb-4">Informazioni Asset</h3>

              <div className="form-group">
                <label className="label">Tag Asset (Obbligatorio)</label>
                <input type="text" name="tag" required className="input font-mono uppercase" placeholder="INV-2024-001" value={formData.tag} onChange={handleChange} />
              </div>

              <div className="form-group">
                <label className="label">Seriale (S/N)</label>
                <div className="relative">
                  <input type="text" name="serial" value={formData.serial} onChange={handleChange} className="input font-mono pl-10" placeholder="Scansiona o digita..." />
                  <Camera className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="label">Categoria</label>
                  <select name="category" value={formData.category} onChange={handleChange} className="input">
                    {(settings.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Modello</label>
                  <select name="model" value={formData.model} onChange={handleChange} className="input">
                    <option value="">Seleziona...</option>
                    {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* 2. CUSTOMER INFO (Moved to Left) */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest border-b pb-2 mb-4">Cliente e Mittente</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="label">Fornitore</label>
                  <select name="supplier" value={formData.supplier} onChange={handleChange} className="input">
                    <option value="">Seleziona...</option>
                    {(settings.suppliers_inbound || []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Cliente Finale</label>
                  <select name="customer" value={formData.customer} onChange={handleChange} className="input">
                    <option value="">Seleziona...</option>
                    {(settings.customers || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: FAULT DETAILS */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest border-b pb-2 mb-4">Dettagli Guasto</h3>
            <div className="form-group">
              <label className="label">Difetto Dichiarato</label>
              <textarea name="faultDeclared" required value={formData.faultDeclared} onChange={handleChange} rows={6} className="input" placeholder="Descrivi dettagliatamente il problema segnalato..."></textarea>
            </div>
            <div className="form-group">
              <label className="label">Note Accettazione</label>
              <textarea name="notes" value={formData.notes} onChange={handleChange} rows={4} className="input" placeholder="Eventuali danni estetici, accessori inclusi, etc."></textarea>
            </div>
          </div>
        </form>
      </div>

      <div className="bg-gray-50 dark:bg-slate-900 p-6 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-6 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 font-medium transition-colors">
          Annulla
        </button>
        <button type="submit" form="new-repair-form" className="px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-lg shadow-indigo-200 dark:shadow-none transition-transform active:scale-95">
          Registra Ingresso
        </button>
      </div>
    </div>
  );
}

// --- FEATURES: KPI & ANALYTICS ---
function KPIView() {
  const [stats, setStats] = useState({ pie: [], bar: [], metrics: {} });
  const [raw, setRaw] = useState([]);

  useEffect(() => {
    service.getRepairs().then(data => {
      setRaw(data);

      // --- 1. Charts Data ---
      // V4.1: Dynamic Pie Chart using ALL_STATUSES
      const pie = ALL_STATUSES.map(s => ({
        name: s, value: data.filter(r => r.status === s).length
      })).filter(x => x.value > 0);

      const last7 = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
      }).reverse();

      const bar = last7.map(date => ({
        name: date.split('-').slice(1).join('/'),
        count: data.filter(r => r.dateIn && r.dateIn.startsWith(date)).length
      }));

      // --- 2. Advanced Metrics (Time Tracking) ---
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      // Helpers for metrics
      const getDuration = (r, status) => {
        if (!r.timeline || r.timeline.length === 0) return 0;
        let total = 0;
        r.timeline.forEach((entry, i) => {
          if (entry.status === status) {
            const start = new Date(entry.date).getTime();
            const nextEntry = r.timeline[i + 1];
            const end = nextEntry ? new Date(nextEntry.date).getTime() : now.getTime();
            total += (end - start);
          }
        });
        return total;
      };

      const getTotalDuration = (r) => {
        if (!r.dateIn) return 0;
        const start = new Date(r.dateIn).getTime();
        const end = r.dateOut ? new Date(r.dateOut).getTime() : now.getTime();
        return end - start;
      };

      // Filter Data by Month
      const thisMonthData = data.filter(r => {
        const d = new Date(r.dateIn);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      });

      const prevMonthDate = new Date();
      prevMonthDate.setMonth(currentMonth - 1);
      const prevMonthData = data.filter(r => {
        const d = new Date(r.dateIn);
        return d.getMonth() === prevMonthDate.getMonth() && d.getFullYear() === prevMonthDate.getFullYear();
      });

      const calcAvg = (dataset, fn) => {
        if (dataset.length === 0) return 0;
        const sum = dataset.reduce((acc, r) => acc + fn(r), 0);
        return sum / dataset.length;
      };

      const metrics = {
        totalTime: { current: calcAvg(thisMonthData, getTotalDuration), prev: calcAvg(prevMonthData, getTotalDuration) },
        diagnosi: { current: calcAvg(thisMonthData, r => getDuration(r, 'Diagnosi')), prev: calcAvg(prevMonthData, r => getDuration(r, 'Diagnosi')) },
        working: { current: calcAvg(thisMonthData, r => getDuration(r, 'In Lavorazione')), prev: calcAvg(prevMonthData, r => getDuration(r, 'In Lavorazione')) },
        parts: { current: calcAvg(thisMonthData, r => getDuration(r, 'Attesa Parti')), prev: calcAvg(prevMonthData, r => getDuration(r, 'Attesa Parti')) }
      };

      setStats({ pie, bar, metrics });
    });
  }, []);

  const downloadCSV = () => {
    const headers = ['ID Lavorazione', 'Tag', 'Modello', 'Seriale', 'Stato', 'Data Ingresso', 'Guasto'];

    const escape = (text) => {
      if (text === null || text === undefined) return '""';
      const str = String(text).replace(/"/g, '""').replace(/\n/g, ' ');
      return `"${str}"`;
    };

    const rows = raw.map(r => [
      r.id,
      r.tag,
      r.model,
      r.serial,
      r.status,
      r.dateIn,
      r.faultDeclared
    ].map(escape).join(';'));

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.map(escape).join(';'), ...rows].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `techlab_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  // Helper Component for Cards
  const KPICard = ({ label, metric, icon: Icon, color }) => {
    const formatTime = (ms) => {
      if (ms === 0) return '-';
      const days = Math.floor(ms / (1000 * 60 * 60 * 24));
      const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      return `${days}g ${hours}h`;
    };

    const diff = metric ? ((metric.current - metric.prev) / (metric.prev || 1)) * 100 : 0;
    const isBetter = diff < 0; // Less time is better

    return (
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden">
        <div className={`absolute top-0 right-0 p-4 opacity-10 ${color}`}>
          <Icon size={64} />
        </div>
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white">
            {metric ? formatTime(metric.current) : '-'}
          </h3>
        </div>
        {metric && metric.prev > 0 && (
          <div className={`mt-4 flex items-center text-xs font-bold ${isBetter ? 'text-green-500' : 'text-red-500'}`}>
            {isBetter ? '↓' : '↑'} {Math.abs(Math.round(diff))}% vs mese prec.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm">
        <h2 className="text-xl font-bold flex items-center gap-2"><Activity /> Analytics & Report</h2>
        <button onClick={downloadCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold transition-colors">
          <Download size={18} /> Esporta CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Tempo Medio Lab" metric={stats.metrics.totalTime} icon={Clock} color="text-blue-500" />
        <KPICard label="Tempo Medio Diagnosi" metric={stats.metrics.diagnosi} icon={Activity} color="text-purple-500" />
        <KPICard label="Tempo In Lavorazione" metric={stats.metrics.working} icon={Wrench} color="text-amber-500" />
        <KPICard label="Tempo Attesa Parti" metric={stats.metrics.parts} icon={Package} color="text-orange-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm h-80 flex flex-col">
          <h3 className="text-sm font-bold uppercase text-gray-400 mb-4">Stato Riparazioni (Attuali)</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.pie} cx="50%" cy="50%" outerRadius={80} fill="#8884d8" dataKey="value" label>
                  {stats.pie.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Volume History */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm h-80 flex flex-col">
          <h3 className="text-sm font-bold uppercase text-gray-400 mb-4">Volume Ingressi (7 Giorni)</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.bar}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- FEATURES: MOBILE OPERATOR MODE (V4.2) ---
function MobileOperatorLayout({ children }) {
  const { profile } = useContext(AuthContext);
  const { setView } = useContext(NavigationContext);
  // activeTab logic is now handled by checking 'view' or local state, but for simplicity we keep it visually synced
  // However, since 'view' is global, we might need a dedicated mobile state wrapper or simpler props
  // For this iteration, we use children rendering.

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white font-sans">
      {/* Mobile Header */}
      <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center shadow-lg z-10">
        <div className="flex items-center gap-2 font-bold text-lg text-indigo-400">
          <Wrench size={24} /> TECHLAB <span className="text-xs text-slate-400 font-normal uppercase tracking-wider border border-slate-600 px-1 rounded">Mobile</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-bold">{profile?.username}</div>
            <div className="text-[10px] text-slate-400 uppercase">{profile?.role}</div>
          </div>
          <button onClick={() => setView('dashboard')} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 transition-colors" title="Esci da Mobile Mode">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {/* Main Mobile Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative bg-slate-900">
        {children}
      </div>
    </div>
  );
}

function MobileNavButton({ icon: Icon, label, active, onClick, isMain }) {
  if (isMain) {
    return (
      <button onClick={onClick} className="relative -top-6 bg-indigo-600 text-white p-4 rounded-full shadow-lg shadow-indigo-500/50 border-4 border-slate-900 active:scale-95 transition-transform">
        <Icon size={28} />
      </button>
    );
  }
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 p-2 w-16 transition-colors ${active ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'}`}>
      <Icon size={24} className={active ? 'animate-bounce-short' : ''} />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

// Wrapper to handle internal mobile routing (Dashboard <-> Scan <-> Detail)
function OperatorDashboard() {
  const [mobileView, setMobileView] = useState('home'); // home, scan, detail
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [activeTab, setActiveTab] = useState('home');

  const goToTicket = (id) => {
    setSelectedTicketId(id);
    setMobileView('detail');
    setActiveTab('home'); // Detail is part of 'home' flow usually
  };

  const handleNav = (tab) => {
    setActiveTab(tab);
    if (tab === 'home') setMobileView('home');
    if (tab === 'scan') setMobileView('scan');
    if (tab === 'profile') setMobileView('profile');
  };

  return (
    <>
      <div className="h-full pb-20">
        {mobileView === 'home' && <MobileHome onSelectTicket={goToTicket} />}
        {mobileView === 'scan' && <MobileScanner onScan={(id) => goToTicket(id)} />}
        {mobileView === 'detail' && <MobileTicketDetail id={selectedTicketId} onBack={() => setMobileView('home')} />}
        {mobileView === 'profile' && <div className="p-8 text-center text-slate-400">Profilo non implementato.</div>}
      </div>

      {/* Bottom Navigation Bar */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-slate-800 border-t border-slate-700 flex justify-around items-center px-2 pb-safe shadow-lg z-20">
        <MobileNavButton icon={LayoutDashboard} label="Home" active={activeTab === 'home'} onClick={() => handleNav('home')} />
        <MobileNavButton icon={Camera} label="Scan" active={activeTab === 'scan'} onClick={() => handleNav('scan')} isMain />
        <MobileNavButton icon={User} label="Profilo" active={activeTab === 'profile'} onClick={() => handleNav('profile')} />
      </div>
    </>
  );
}

function MobileHome({ onSelectTicket }) {
  const [repairs, setRepairs] = useState([]);
  const { user } = useContext(AuthContext);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const all = await service.getRepairs();
    const relevant = all.filter(r =>
      r.assignedTo === user.username ||
      r.assignedTo === user.email ||
      r.status === 'In Lavorazione' ||
      r.status === 'Ingresso'
    ).sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));
    setRepairs(relevant);
    setLoading(false);
  };

  const filteredRepairs = repairs.filter(r =>
    (r.tag || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.model || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.serial || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 space-y-6">
      {/* Search Bar */}
      <div className="bg-slate-800 p-2 rounded-xl flex items-center gap-2 border border-slate-700 mb-4 sticky top-0 z-10 shadow-md">
        <Search className="text-slate-400 ml-2" size={20} />
        <input
          type="text"
          placeholder="Cerca ID, Modello, Seriale..."
          className="bg-transparent text-white w-full outline-none placeholder-slate-500"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button onClick={() => setSearch('')}><X className="text-slate-400" size={18} /></button>}
      </div>

      {/* Welcome / Stats Widget (Only show if not searching) */}
      {!search && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-bold">Ciao, {user?.displayName?.split(' ')[0] || 'Tecnico'}!</h2>
              <p className="opacity-80 text-xs">Buon lavoro.</p>
            </div>
            <div className="p-2 bg-white/10 rounded-full"><Activity size={20} /></div>
          </div>
          <div className="flex gap-3">
            <div className="bg-black/20 rounded-lg p-2 flex-1 text-center backdrop-blur-sm">
              <div className="text-xl font-bold">{repairs.filter(r => r.status === 'In Lavorazione').length}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-80">In Corso</div>
            </div>
            <div className="bg-black/20 rounded-lg p-2 flex-1 text-center backdrop-blur-sm">
              <div className="text-xl font-bold">{repairs.filter(r => r.status === 'Ingresso').length}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-80">Da Fare</div>
            </div>
          </div>
        </div>
      )}

      {/* Active Jobs List */}
      <div>
        <h3 className="font-bold text-slate-400 uppercase tracking-widest text-xs mb-3 ml-1">Lavorazioni {search ? 'Filtrate' : 'Attive'}</h3>
        <div className="space-y-3">
          {loading ? <div className="text-center p-4 text-slate-500">Caricamento...</div> : filteredRepairs.map(r => (
            <div key={r.id} onClick={() => onSelectTicket(r.id)} className="bg-slate-800 rounded-xl p-4 border border-slate-700 shadow-sm active:scale-[0.98] transition-transform cursor-pointer hover:bg-slate-750">
              <div className="flex justify-between items-start mb-2">
                <Badge status={r.status} />
                <span className="text-xs font-mono text-slate-500">{r.tag}</span>
              </div>
              <h4 className="font-bold text-lg text-white mb-1">{r.model}</h4>
              <p className="text-sm text-slate-400 line-clamp-2 mb-3">"{r.faultDeclared}"</p>
              <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-700 pt-3">
                <div className="flex items-center gap-1"><Clock size={12} /> {new Date(r.dateIn).toLocaleDateString()}</div>
                <div className="flex items-center gap-1 text-indigo-400 font-bold">Apri <ChevronRight size={14} /></div>
              </div>
            </div>
          ))}
          {filteredRepairs.length === 0 && !loading && (
            <div className="text-center p-8 text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">
              <p>{search ? 'Nessun risultato.' : 'Nessuna lavorazione attiva.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// NOTE: Requires 'html5-qrcode' package installed
import { Html5QrcodeScanner } from 'html5-qrcode';

function MobileScanner({ onScan }) {
  const scannerRef = useRef(null);

  useEffect(() => {
    // Only init if element exists
    if (!document.getElementById('reader')) return;

    const scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    );

    scanner.render((decodedText) => {
      // Success
      console.log("Scanned:", decodedText);
      // Assuming decodedText is the ID or Tag. 
      // Ideally we resolve Tag -> ID here, but for now passing value.
      // We will pause usage of real scanner to avoid errors if logic needs checks.
      // Creating a "Simulated" wrapper for safety in this strict environment first.

      // Wait, Html5QrcodeScanner is aggressive. We should clear it on success.
      scanner.clear();
      onScan(decodedText);
    }, (error) => {
      // Ignore errors (scanning...)
    });

    scannerRef.current = scanner;

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(err => console.error("Failed to clear scanner", err));
      }
    };
  }, []);

  return (
    <div className="p-4 flex flex-col h-full bg-slate-900">
      <h2 className="text-xl font-bold text-white mb-4 text-center">Inquadra QR Code</h2>
      <div className="flex-1 flex items-center justify-center bg-black rounded-2xl overflow-hidden relative">
        <div id="reader" className="w-full h-full max-w-sm"></div>
        {/* Fallback / Simulator if camera fails or permissions denied in this env */}
        <div className="absolute bottom-4 left-0 right-0 p-4">
          <p className="text-center text-xs text-gray-500 mb-2">Simulazione (Dev Mode)</p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => onScan("MOCK-ID-123")} className="px-3 py-1 bg-gray-800 text-xs rounded border border-gray-600">Simula Scan</button>
          </div>
        </div>
      </div>
      <p className="text-center text-slate-400 text-sm mt-4">Posiziona il codice al centro del riquadro</p>
    </div>
  );
}


function MobileTicketDetail({ id, onBack }) {
  const [repair, setRepair] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useContext(AuthContext);

  useEffect(() => {
    service.getRepairById(id).then(r => {
      // Logic to find by TAG if ID failed? 
      // For now assuming ID.
      if (!r) {
        // Try searching by Tag in all repairs? (Expensive but okay for Mobile fallback)
        service.getRepairs().then(list => {
          const match = list.find(l => l.tag === id || l.id === id);
          setRepair(match);
          setLoading(false);
        });
      } else {
        setRepair(r);
        setLoading(false);
      }
    });
  }, [id]);

  const updateStatus = async (newStatus) => {
    if (!repair) return;
    setLoading(true);
    await service.updateRepairStatus(repair.id, newStatus, user.displayName, `Stato cambiato da Mobile: ${newStatus}`);
    setRepair({ ...repair, status: newStatus });
    setLoading(false);
  };

  if (loading) return <div className="p-8 text-center text-white">Caricamento...</div>;
  if (!repair) return <div className="p-8 text-center text-white">Riparazione non trovata. <button onClick={onBack} className="text-indigo-400 underline block mt-2">Torna indietro</button></div>;

  const isWorking = repair.status === 'In Lavorazione';

  return (
    <div className="min-h-full bg-slate-900 text-white pb-20">
      {/* Header */}
      <div className="sticky top-0 bg-slate-800 p-4 border-b border-slate-700 z-10 flex items-center gap-3 shadow-md">
        <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-700 rounded-full"><ChevronLeft size={24} /></button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-indigo-400 bg-indigo-900/30 px-1.5 rounded">{repair.tag}</span>
            <Badge status={repair.status} />
          </div>
          <h2 className="font-bold text-lg leading-tight truncate">{repair.model}</h2>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Main Action Card */}
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 shadow-sm">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Stato Lavorazione</h3>
          <div className="flex gap-3">
            {repair.status === 'Ingresso' && (
              <button onClick={() => updateStatus('In Lavorazione')} className="flex-1 py-3 bg-indigo-600 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 active:scale-95 transition-all">
                <PlayCircle size={20} /> Prendi in Carico
              </button>
            )}
            {repair.status === 'In Lavorazione' && (
              <>
                <button onClick={() => updateStatus('Attesa Parti')} className="flex-1 py-3 bg-orange-600/20 text-orange-400 border border-orange-600/50 rounded-xl font-bold flex items-center justify-center gap-2">
                  <PauseCircle size={20} /> Attesa
                </button>
                <button onClick={() => updateStatus('Pronto')} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-900/20">
                  <CheckCircle size={20} /> Completa
                </button>
              </>
            )}
            {repair.status === 'Pronto' && (
              <div className="flex-1 py-3 bg-gray-700 rounded-xl text-center text-gray-400 text-sm">Riparazione Completata</div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Guasto Dichiarato</h3>
            <p className="bg-slate-800/50 p-3 rounded-lg text-sm border border-slate-700/50">{repair.faultDeclared}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Note Tecniche</h3>
            <p className="bg-slate-800/50 p-3 rounded-lg text-sm border border-slate-700/50 min-h-[60px]">{repair.techNotes || 'Nessuna nota tecnica.'}</p>
          </div>
        </div>

        {/* Parts Section Shortcut */}
        <div>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Ricambi Utilizzati</h3>
          <div className="bg-slate-800 rounded-xl p-1">
            {(repair.replacedParts || []).length > 0 ? (
              <ul className="divide-y divide-slate-700">
                {repair.replacedParts.map((p, i) => (
                  <li key={i} className="p-3 text-sm flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-indigo-500"></div>{p}</li>
                ))}
              </ul>
            ) : <p className="p-3 text-center text-sm text-slate-600 italic">Nessun ricambio.</p>}

            <button className="w-full py-3 border-t border-slate-700 text-indigo-400 font-bold text-sm hover:bg-slate-700/50 rounded-b-xl">
              + Aggiungi Ricambio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Missing icons import correction if needed: PlayCircle, PauseCircle
