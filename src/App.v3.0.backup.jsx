import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import {
  LayoutDashboard,
  Wrench,
  Truck,
  Settings,
  Search,
  Plus,
  AlertTriangle,
  CheckCircle,
  Clock,
  Package,
  Moon,
  Sun,
  LogOut,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  User,
  Calendar,
  MoreVertical,
  X,
  Users,
  ExternalLink,
  Trash2,
  Activity
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, addDoc, updateDoc, doc, query, orderBy, where, serverTimestamp, setDoc, getDoc, arrayUnion, arrayRemove
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
  'Attesa Parti': { next: 'In Lavorazione', color: 'bg-orange-100 text-orange-800' },
  'In RMA': { next: 'Rientro RMA', color: 'bg-pink-100 text-pink-800' },
  'Rientro RMA': { next: 'In Lavorazione', color: 'bg-indigo-100 text-indigo-800' },
  'Riparato': { next: 'Spedito', color: 'bg-emerald-100 text-emerald-800' },
  'Spedito': { color: 'bg-gray-100 text-gray-800' }
};

const INITIAL_SETTINGS = {
  categories: ['Laptop', 'Desktop', 'Server', 'Mobile', 'Tablet'],
  models: ['ThinkPad X1', 'MacBook Pro', 'Dell XPS', 'iPhone 15', 'Galaxy S24'],
  suppliers: ['TechParts Inc.', 'Global Components', 'ScreenFix', 'Apple Support', 'Dell Service'],
  spareParts: ['Schermo', 'Batteria', 'Tastiera', 'Trackpad', 'Ventola', 'Scheda Madre', 'Altoparlanti', 'Scocca', 'Connettore Ricarica']
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

  getSettings() { return INITIAL_SETTINGS; }
}

const service = new RepairService();
const AuthContext = createContext(null);
const NavigationContext = createContext(null);

// --- MAIN COMPONENT ---

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

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  if (loading) return <div className="h-screen flex items-center justify-center">Caricamento...</div>;
  if (!user) return <AuthScreen onLogin={() => { }} />;

  return (
    <AuthContext.Provider value={{ user, profile, refreshProfile: async () => setProfile(await service.getUserProfile(user.uid)), logout: () => { service.logout(); } }}>
      <NavigationContext.Provider value={{ view, setView, sidebarOpen, setSidebarOpen, collapsed, setCollapsed }}>
        <div className="flex h-screen bg-gray-50 text-gray-900 dark:bg-slate-900 dark:text-gray-100 font-sans transition-colors">
          <Sidebar />
          <main className="flex-1 overflow-hidden flex flex-col relative w-full">
            <Header darkMode={darkMode} setDarkMode={setDarkMode} />
            <div className="flex-1 overflow-auto p-4 md:p-6">
              <MainContent />
            </div>
          </main>
        </div>
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
function Sidebar() {
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
          <NavLink icon={Truck} label="Logistica" viewName="logistics" current={view} setView={setView} collapsed={collapsed} />

          {profile?.role === 'manager' && (
            <>
              {!collapsed && <h3 className="px-4 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 mt-6">Admin</h3>}
              <div className={collapsed ? "mt-4 border-t border-gray-100 dark:border-slate-700 pt-4" : ""}>
                <NavLink icon={Users} label="Team" viewName="team" current={view} setView={setView} collapsed={collapsed} />
                <NavLink icon={Activity} label="KPI" viewName="kpi" current={view} setView={setView} collapsed={collapsed} />
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
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{user?.email}</p>
          <p className="text-xs text-gray-400 capitalize">{profile?.role || 'Guest'}</p>
        </div>
      </div>
    </header>
  );
}

// --- CONTENT ROUTER ---
function MainContent() {
  const { profile } = useContext(AuthContext);
  const { view, setView } = useContext(NavigationContext);
  // Use local state only for detail selection, view switching is now global/context
  const [selectedId, setSelectedId] = useState(null);

  // Effect to reset selectedId when view changes significantly?
  // Actually, handling detail view as a pseudo-route 'detail' works best if integrated into global view state
  // BUT, keeping it simple: 'table' view renders table. 'detail' view renders detail.
  // We need to sync the global view state.

  return (
    <>
      {view === 'table' && <OperatorTable onAdd={() => setView('new')} onSelect={(id) => { setSelectedId(id); setView('detail'); }} />}
      {view === 'new' && <NewRepairForm onCancel={() => setView('table')} onSuccess={() => setView('table')} />}
      {view === 'detail' && <RepairDetailView id={selectedId} onBack={() => { setView('table'); setSelectedId(null); }} />}
      {view === 'team' && <TeamManagementView />}
      {view === 'logistics' && <div className="p-10 text-center text-gray-400">Modulo Logistica in arrivo</div>}
      {view === 'kpi' && <KPIView />}
    </>
  );
}

// --- FEATURES: TEAM ---
function TeamManagementView() {
  const [users, setUsers] = useState([]);
  const { user: currentUser, refreshProfile } = useContext(AuthContext);

  useEffect(() => {
    service.getAllUsers().then(setUsers);
  }, []);

  const handleRoleChange = async (uid, newRole) => {
    await service.updateUserRole(uid, newRole);
    setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    if (uid === currentUser.uid) refreshProfile();
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-6">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Users /> Gestione Team</h2>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b dark:border-slate-700 text-gray-400">
              <th className="p-3">Email</th>
              <th className="p-3">Ruolo Attuale</th>
              <th className="p-3">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.uid} className="border-b dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                <td className="p-3 font-medium">{u.email}</td>
                <td className="p-3 capitalize">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${u.role === 'manager' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="p-3">
                  <select
                    className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded px-2 py-1"
                    value={u.role || 'operator'}
                    onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                    disabled={u.uid === currentUser.uid} // Safety: avoid removing own admin access easily? optional.
                  >
                    <option value="operator">Operatore</option>
                    <option value="logistics">Logistica</option>
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

// --- FEATURES: REPAIR DETAIL VIEW (Updated with RMA & Fixes) ---
function RepairDetailView({ id, onBack }) {
  const { profile } = useContext(AuthContext); // Access profile for role check
  const [repair, setRepair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rmaMode, setRmaMode] = useState(false);
  const [rmaForm, setRmaForm] = useState({ serviceName: '', tracking: '', notes: '' });

  // Local state for tech notes editing
  const [techNotes, setTechNotes] = useState('');

  // Ref for file input - MUST be defined before early returns
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(null);

  const load = async () => {
    setLoading(true);
    const data = await service.getRepairById(id);
    setRepair(data);
    setTechNotes(data.techNotes || ''); // Initialize local state
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleStatusUpdate = async (newStatus, extra = {}) => {
    await service.updateStatus(id, newStatus, extra);
    setRmaMode(false);
    load();
  };

  const saveTechNotes = async () => {
    await service.updateStatus(id, repair.status, { techNotes });
    // Optional: toast notification
  };

  const togglePriority = async () => {
    await service.updateStatus(id, repair.status, { priorityClaim: !repair.priorityClaim });
    load();
  };

  if (loading) return <div>Caricamento...</div>;
  if (!repair) return <div>Riparazione non trovata.</div>;

  const steps = ['Ingresso', 'Diagnosi', 'In Lavorazione', 'Attesa Parti', repair.status === 'In RMA' || repair.status === 'Rientro RMA' ? 'In RMA' : null, 'Riparato', 'Spedito'].filter(Boolean);
  const currentIdx = steps.indexOf(repair.status === 'Rientro RMA' ? 'In RMA' : repair.status);

  const submitRMA = () => {
    handleStatusUpdate('In RMA', { rmaInfo: { ...rmaForm, dateSent: new Date().toISOString() } });
  };

  const canEditPriority = profile?.role === 'manager' || profile?.role === 'logistics';

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Optimistic UI or Loading state could be added here
    const url = await service.uploadPhoto(id, file);
    setRepair(prev => ({ ...prev, photos: [...(prev.photos || []), url] }));
  };

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
          <button onClick={onBack} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full shrink-0">
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
        <button onClick={() => fileInputRef.current?.click()} className="w-full md:w-auto flex justify-center items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg shadow-sm hover:bg-gray-50 text-sm font-medium">
          <Camera size={16} /> Salva Foto
        </button>
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

            {/* SPARE PARTS MONITOR (V3 Feature) */}
            {['In Lavorazione', 'Attesa Parti', 'Riparato', 'Spedito'].includes(repair.status) && (
              <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-xl">
                <h3 className="text-xs font-bold uppercase text-indigo-800 dark:text-indigo-300 mb-3 flex items-center gap-2">
                  <Wrench size={14} /> Parti Sostituite
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {INITIAL_SETTINGS.spareParts.map(part => {
                    const isChecked = (repair.replacedParts || []).includes(part);
                    const isReadOnly = ['Riparato', 'Spedito'].includes(repair.status);

                    return (
                      <label key={part} className={`flex items-center gap-2 group ${isReadOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isReadOnly}
                          onChange={async (e) => {
                            const newParts = e.target.checked
                              ? [...(repair.replacedParts || []), part]
                              : (repair.replacedParts || []).filter(p => p !== part);

                            // Optimistic Update
                            setRepair(prev => ({ ...prev, replacedParts: newParts }));
                            await service.updateParts(repair.id, newParts);
                          }}
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 transition-colors disabled:opacity-50"
                        />
                        <span className={`text-sm ${isChecked ? 'font-bold text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'} ${!isReadOnly && 'group-hover:text-indigo-600'} transition-colors`}>
                          {part}
                        </span>
                      </label>
                    );
                  })}
                </div>
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
                    <ActionButton label="Pezzi di Ricambio" onClick={() => handleStatusUpdate('Attesa Parti')} />
                    <ActionButton label="Riparazione Completata" onClick={() => handleStatusUpdate('Riparato')} primary />
                    <ActionButton label="Spedisci a Service Esterno (RMA)" onClick={() => setRmaMode(true)} className="col-span-2 border-orange-500 text-orange-600" />
                  </>
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
      </div>

      {/* PHOTO PREVIEW MODAL */}
      {viewPhoto && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-fade-in" onClick={() => setViewPhoto(null)}>
          <button className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full" onClick={() => setViewPhoto(null)}><X size={32} /></button>
          <img src={viewPhoto} className="max-w-full max-h-full object-contain rounded shadow-2xl" />
        </div>
      )}

      {/* RMA MODAL */}
      {rmaMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl max-w-md w-full shadow-2xl animate-fade-in-up">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><ExternalLink /> Gestione RMA Esterno</h3>
            <div className="space-y-4">
              <div>
                <label className="label">Laboratorio Esterno</label>
                <select className="input" value={rmaForm.serviceName} onChange={e => setRmaForm({ ...rmaForm, serviceName: e.target.value })}>
                  <option value="">Seleziona...</option>
                  <option>Apple Support</option>
                  <option>Dell Service</option>
                  <option>Laboratorio Partner</option>
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
      )}
    </div>
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
function UserBadge({ role }) { return <span className="capitalize">{role}</span>; }

// Helpers for date
const dateToStr = (d) => d?.toDate?.()?.toISOString() || d;
const Badge = ({ status }) => {
  const config = STATUS_FLOW[status] || STATUS_FLOW['Ingresso'];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}>{status}</span>;
}

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

function OperatorTable({ onAdd, onSelect }) {
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
      < div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col" >
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 dark:bg-slate-900 sticky top-0 z-10 text-xs font-bold text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="p-4 border-b dark:border-slate-700">Tag Asset</th>
                <th className="p-4 border-b dark:border-slate-700">Categoria</th>
                <th className="p-4 border-b dark:border-slate-700">Modello</th>
                <th className="p-4 border-b dark:border-slate-700 w-24">Stato</th>
                <th className="p-4 border-b dark:border-slate-700">Priorità</th>
                <th className="p-4 border-b dark:border-slate-700">Guasto Dichiarato</th>
                <th className="p-4 border-b dark:border-slate-700 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700 text-sm">
              {filtered.map(row => (
                <tr key={row.id} onClick={() => onSelect(row.id)} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors group">
                  <td className="p-4">
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
                    <Badge status={row.status} />
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
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-10 text-center text-gray-400">
              Nessuna riparazione trovata.
            </div>
          )}
        </div>
        <div className="bg-gray-50 dark:bg-slate-900 p-3 border-t border-gray-200 dark:border-slate-700 flex justify-between items-center text-xs text-gray-500">
          <span>Visualizzati {filtered.length} record</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-white dark:bg-slate-800 border rounded hover:bg-gray-100">Indietro</button>
            <button className="px-3 py-1 bg-white dark:bg-slate-800 border rounded hover:bg-gray-100">Avanti</button>
          </div>
        </div>
      </div >
    </div >
  );
}

function NewRepairForm({ onCancel, onSuccess }) {
  const settings = service.getSettings();
  const [formData, setFormData] = useState({
    tag: '',
    category: 'Laptop',
    model: '',
    serial: '',
    supplier: '',
    customer: '', // Added customer
    faultDeclared: '',
    notes: '',
    technician: ''
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await service.addRepair(formData);
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
                    {settings.categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Modello</label>
                  <input type="text" name="model" required value={formData.model} onChange={handleChange} className="input" placeholder="Es. MacBook Pro" />
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
                    {settings.suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Cliente Finale</label>
                  <input type="text" name="customer" className="input" placeholder="Es. Mario Rossi" value={formData.customer} onChange={handleChange} />
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
      const pie = Object.keys(STATUS_FLOW).map(s => ({
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
    const headers = ['ID', 'Tag', 'Modello', 'Seriale', 'Stato', 'Data Ingresso', 'Guasto', 'Parti Sostituite'];

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
      r.faultDeclared,
      (r.replacedParts || []).join(' | ')
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
