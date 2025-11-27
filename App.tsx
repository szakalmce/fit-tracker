import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { 
  Utensils, 
  History, 
  User, 
  Plus, 
  Search, 
  Trash2, 
  ChevronRight, 
  Flame, 
  Scale, 
  Save, 
  X,
  Loader2,
  TrendingUp,
  Beef,
  Wheat,
  Droplets,
  Bell,
  Clock,
  RotateCcw,
  Check,
  Calendar,
  ShoppingBag,
  Database,
  WifiOff
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  setDoc,
  getDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { getMessaging, getToken } from 'firebase/messaging';

// --- TYPES ---

interface UserStats {
  id?: string;
  date: string;
  displayName?: string;
  weight: number;
  height: number;
  age: number;
  gender: 'male' | 'female';
  activity: number;
  tdee: number;
  proteinTarget: number;
  fatTarget: number;
  carbTarget: number;
}

interface NotificationSettings {
  enabled: boolean;
  mealReminderTime: string;
  weightReminderTime: string;
  fcmToken?: string | null;
}

interface DailyLog {
  id: string;
  date: string;
  name: string;
  kcal: number;
  p: number;
  f: number;
  c: number;
  createdAt: any; // Timestamp or number in demo
  ingredients?: Ingredient[];
}

interface Ingredient {
  name: string;
  amount: number;
  unit: string;
  kcal: number;
  p: number;
  f: number;
  c: number;
}

interface SavedMeal {
  id: string;
  name: string;
  kcal: number;
  p: number;
  f: number;
  c: number;
  ingredients?: Ingredient[];
}

interface OpenFoodFactsProduct {
  code: string;
  product_name_pl?: string;
  product_name?: string;
  brands?: string;
  nutriments: {
    'energy-kcal_100g'?: number;
    proteins_100g?: number;
    fat_100g?: number;
    carbohydrates_100g?: number;
  };
}

// --- CONFIG & INIT ---

const APP_ID = 'fit-tracker-app';

// USER: Replace these with real keys for Cloud Persistence. 
// If left as "Dummy", app uses LocalStorage (Demo Mode).
const firebaseConfig = {
  apiKey: "AIzaSyDummyKey-PleaseReplaceMe", 
  authDomain: "dummy-project.firebaseapp.com",
  projectId: "dummy-project",
  storageBucket: "dummy-project.appspot.com",
  messagingSenderId: "000000000",
  appId: "1:00000000:web:000000"
};

// Check if we should use Mock Mode
const isDemoMode = firebaseConfig.apiKey.includes("Dummy");

let auth: any;
let db: any;
let messaging: any;

if (!isDemoMode) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    try {
      messaging = getMessaging(app);
    } catch (e) {
      console.warn("Messaging init failed", e);
    }
  } catch (e) {
    console.error("Firebase init failed", e);
  }
}

// --- DATA LAYER ABSTRACTION (Firebase <-> LocalStorage) ---

const MOCK_DELAY = 300; // Simulate network latency

// Helper to simulate Firestore behavior in LocalStorage
const mockDB = {
  getKey: (collection: string) => `ft_v2_${collection}`,
  
  subscribe: (collectionName: string, callback: (data: any[]) => void) => {
    const key = mockDB.getKey(collectionName);
    const load = () => {
      try {
        const raw = localStorage.getItem(key);
        const data = raw ? JSON.parse(raw) : [];
        callback(data);
      } catch (e) { callback([]); }
    };
    load(); // Initial load
    
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.key === key) load();
    };
    window.addEventListener('local-storage-update', handler);
    return () => window.removeEventListener('local-storage-update', handler);
  },

  add: async (collectionName: string, data: any) => {
    await new Promise(r => setTimeout(r, MOCK_DELAY));
    const key = mockDB.getKey(collectionName);
    const raw = localStorage.getItem(key);
    const current = raw ? JSON.parse(raw) : [];
    const newItem = { 
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2,9)}`, 
      ...data, 
      createdAt: { seconds: Date.now() / 1000 } 
    };
    // Prepend for "newest first" (simplified)
    const updated = [newItem, ...current];
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { key } }));
    return newItem;
  },

  delete: async (collectionName: string, id: string) => {
    await new Promise(r => setTimeout(r, MOCK_DELAY));
    const key = mockDB.getKey(collectionName);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const current = JSON.parse(raw);
    const updated = current.filter((item: any) => item.id !== id);
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { key } }));
  },

  saveSettings: async (docName: string, data: any) => {
    await new Promise(r => setTimeout(r, MOCK_DELAY));
    const key = mockDB.getKey(docName); // storage single docs as keys
    localStorage.setItem(key, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { key } }));
  },
  
  getSettings: async (docName: string) => {
    const key = mockDB.getKey(docName);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }
};

// Generic Hook for Data Subscription
const useDataSubscription = (collectionName: string, user: FirebaseUser | null, queryConstraint?: any) => {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;

    if (isDemoMode) {
      // MOCK MODE
      return mockDB.subscribe(collectionName, (localData) => {
         // Sort logic for demo mode (simple createdAt desc)
         const sorted = [...localData].sort((a, b) => {
            const tA = a.createdAt?.seconds || 0;
            const tB = b.createdAt?.seconds || 0;
            return tB - tA;
         });
         setData(sorted);
      });
    } else if (db) {
      // FIREBASE MODE
      // Note: We reconstruct query here because passing complex query objects to hooks is tricky
      const q = query(
        collection(db, 'artifacts', APP_ID, 'users', user.uid, collectionName),
        orderBy('createdAt', 'desc')
      );
      return onSnapshot(q, (snapshot) => {
        setData(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    }
  }, [user, collectionName]);

  return data;
};

// --- COMPONENT HELPERS ---

const Toast = ({ message, onClose }: { message: string, onClose: () => void }) => (
  <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[100] animate-in slide-in-from-top-5 fade-in duration-300 w-[90%] max-w-sm">
    <div className="bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-2xl shadow-emerald-900/50 flex items-center gap-3">
      <div className="bg-white/20 p-1 rounded-full"><Check size={14} className="stroke-[3]" /></div>
      <span className="font-semibold text-sm">{message}</span>
    </div>
  </div>
);

const ProgressBar = ({ current, max, colorClass, label }: { current: number, max: number, colorClass: string, label: string }) => {
  const percentage = Math.min(Math.max((current / max) * 100, 0), 100);
  return (
    <div className="flex flex-col w-full mb-2">
      <div className="flex justify-between text-xs mb-1 text-zinc-400">
        <span>{label}</span>
        <span>{Math.round(current)} / {max} g</span>
      </div>
      <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} transition-all duration-500 ease-out`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'diary' | 'history' | 'profile'>('diary');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // --- AUTH ---
  useEffect(() => {
    if (isDemoMode) {
      // Mock User
      setTimeout(() => {
        setUser({ uid: 'demo_user', isAnonymous: true } as FirebaseUser);
        setLoading(false);
      }, 800);
    } else {
      if (!auth) return;
      const unsubscribe = onAuthStateChanged(auth, (u) => {
        if (u) setUser(u);
        else signInAnonymously(auth).catch(e => console.error(e));
        setLoading(false);
      });
      return () => unsubscribe();
    }
  }, []);

  // --- DATA FETCHING ---
  const logs = useDataSubscription('daily_logs', user);
  const savedMeals = useDataSubscription('saved_meals', user);
  const statsHistory = useDataSubscription('user_stats', user);
  
  const stats = useMemo(() => statsHistory.length > 0 ? statsHistory[0] : null, [statsHistory]);
  
  const currentDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  
  const todaysLogs = useMemo(() => logs.filter((l: DailyLog) => l.date === currentDate), [logs, currentDate]);

  const dailyTotals = useMemo(() => {
    return todaysLogs.reduce((acc, curr) => ({
      kcal: acc.kcal + curr.kcal,
      p: acc.p + curr.p,
      f: acc.f + curr.f,
      c: acc.c + curr.c,
    }), { kcal: 0, p: 0, f: 0, c: 0 });
  }, [todaysLogs]);

  const targets = useMemo(() => {
    if (stats) return stats;
    return { tdee: 2000, proteinTarget: 150, fatTarget: 65, carbTarget: 200 };
  }, [stats]);

  // --- ACTIONS (Database Agnostic) ---
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddLog = async (data: any) => {
    if (!user) return;
    try {
      if (isDemoMode) await mockDB.add('daily_logs', data);
      else await addDoc(collection(db, 'artifacts', APP_ID, 'users', user.uid, 'daily_logs'), { ...data, createdAt: serverTimestamp() });
    } catch (e) {
      console.error("Add Log Error", e);
    }
  };

  const handleAddSavedMeal = async (data: any) => {
    if (!user) return;
    try {
      if (isDemoMode) await mockDB.add('saved_meals', data);
      else await addDoc(collection(db, 'artifacts', APP_ID, 'users', user.uid, 'saved_meals'), { ...data });
    } catch (e) { console.error(e); }
  };

  const handleDeleteLog = async (id: string) => {
    if (!user) return;
    if (isDemoMode) await mockDB.delete('daily_logs', id);
    else await deleteDoc(doc(db, 'artifacts', APP_ID, 'users', user.uid, 'daily_logs', id));
    showToast("Usunięto wpis");
  };

  const handleDeleteSaved = async (id: string) => {
    if (!user) return;
    if (isDemoMode) await mockDB.delete('saved_meals', id);
    else await deleteDoc(doc(db, 'artifacts', APP_ID, 'users', user.uid, 'saved_meals', id));
    showToast("Usunięto z ulubionych");
  };

  const handleSaveProfile = async (newStats: any) => {
    if (!user) return;
    try {
      if (isDemoMode) await mockDB.add('user_stats', newStats);
      else await addDoc(collection(db, 'artifacts', APP_ID, 'users', user.uid, 'user_stats'), { ...newStats, createdAt: serverTimestamp() });
      showToast("Zapisano profil");
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="h-screen w-full bg-zinc-950 flex flex-col gap-4 items-center justify-center text-emerald-500">
      <Loader2 className="h-12 w-12 animate-spin" />
      <div className="text-sm text-zinc-500">Ładowanie FitTracker...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans pb-24 selection:bg-emerald-500/30">
      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
      
      {isDemoMode && (
        <div className="bg-yellow-600/20 text-yellow-500 text-[10px] font-bold text-center py-1 uppercase tracking-widest border-b border-yellow-600/20 flex justify-center items-center gap-2">
          <WifiOff size={10} /> Tryb Demo (Dane lokalne)
        </div>
      )}

      <div className="max-w-md mx-auto w-full relative min-h-screen">
        
        {/* VIEW: DIARY */}
        {currentView === 'diary' && (
          <DiaryView 
            logs={todaysLogs} 
            totals={dailyTotals} 
            targets={targets} 
            onDelete={handleDeleteLog}
            onOpenAdd={() => setModalOpen(true)}
            userName={stats?.displayName}
          />
        )}

        {/* VIEW: HISTORY */}
        {currentView === 'history' && (
          <HistoryView allLogs={logs} targets={targets} />
        )}

        {/* VIEW: PROFILE */}
        {currentView === 'profile' && (
          <ProfileView 
            stats={stats} 
            history={statsHistory} 
            user={user} 
            db={db}
            isDemoMode={isDemoMode}
            onSave={handleSaveProfile}
            onSuccess={showToast}
          />
        )}

        {/* ADD MEAL MODAL */}
        {modalOpen && (
          <AddMealModal 
            onClose={() => setModalOpen(false)} 
            currentDate={currentDate}
            savedMeals={savedMeals}
            onDeleteSaved={handleDeleteSaved}
            onSaveLog={handleAddLog}
            onSaveFavorite={handleAddSavedMeal}
            onSuccess={showToast}
          />
        )}

      </div>

      {/* --- NAV --- */}
      <div className="fixed bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur-lg border-t border-zinc-800 z-40 max-w-md mx-auto w-full">
        <div className="flex justify-around items-center h-16">
          <NavButton active={currentView === 'diary'} onClick={() => setCurrentView('diary')} icon={<Utensils size={20} />} label="Dziennik" />
          <NavButton active={currentView === 'history'} onClick={() => setCurrentView('history')} icon={<History size={20} />} label="Historia" />
          <NavButton active={currentView === 'profile'} onClick={() => setCurrentView('profile')} icon={<User size={20} />} label="Profil" />
        </div>
      </div>
    </div>
  );
}

const NavButton = ({ active, onClick, icon, label }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center justify-center w-full h-full transition-colors ${active ? 'text-emerald-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
    <div className={`mb-1 p-1 rounded-full ${active ? 'bg-emerald-400/10' : ''}`}>{icon}</div>
    <span className="text-[10px] font-medium">{label}</span>
  </button>
);

// ---------------- DIARY VIEW ----------------

const DiaryView = ({ logs, totals, targets, onDelete, onOpenAdd, userName }: any) => {
  const remaining = Math.max(0, targets.tdee - totals.kcal);
  
  return (
    <div className="p-4 space-y-6 animate-in fade-in duration-500">
      <header className="flex justify-between items-center pt-2">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">
            {userName ? `Cześć, ${userName}` : 'Dziś'}
          </h1>
          <p className="text-zinc-400 text-sm font-medium">
            {new Date().toLocaleDateString('pl-PL', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </header>

      <div className="bg-zinc-900 rounded-2xl p-5 shadow-lg border border-zinc-800/50">
        <div className="flex justify-between items-end mb-4">
          <div>
            <p className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Pozostało</p>
            <div className="text-4xl font-extrabold text-white flex items-baseline gap-1">
              {Math.round(remaining)} <span className="text-base font-normal text-emerald-500">kcal</span>
            </div>
          </div>
          <div className="relative h-14 w-14 flex items-center justify-center">
             <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
               <path className="text-zinc-800" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="3" />
               <path className={remaining === 0 ? 'text-red-500' : 'text-emerald-500'} strokeDasharray={`${Math.min((totals.kcal / targets.tdee) * 100, 100)}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
             </svg>
             <Flame size={18} className={`absolute ${remaining === 0 ? 'text-red-500' : 'text-emerald-500'}`} />
          </div>
        </div>
        <div className="space-y-3">
           <ProgressBar label="Białko" current={totals.p} max={targets.proteinTarget} colorClass="bg-blue-500" />
           <ProgressBar label="Tłuszcze" current={totals.f} max={targets.fatTarget} colorClass="bg-yellow-500" />
           <ProgressBar label="Węglowodany" current={totals.c} max={targets.carbTarget} colorClass="bg-rose-500" />
        </div>
      </div>

      <button onClick={onOpenAdd} className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 active:scale-[0.98] transition-all">
        <Plus size={20} /> Dodaj Posiłek
      </button>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-300">Posiłki</h2>
        {logs.length === 0 ? (
          <div className="text-center py-10 text-zinc-600 bg-zinc-900/30 rounded-xl border border-dashed border-zinc-800">
            <Utensils className="mx-auto h-10 w-10 mb-2 opacity-50" />
            <p>Brak wpisów</p>
          </div>
        ) : (
          logs.map((log: DailyLog) => (
            <div key={log.id} className="group bg-zinc-900 p-4 rounded-xl border border-zinc-800 flex justify-between items-center hover:border-zinc-700 transition-all">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                   <h3 className="font-medium text-zinc-200 truncate pr-2">{log.name}</h3>
                   {log.ingredients && log.ingredients.length > 1 && (
                     <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">{log.ingredients.length} skł.</span>
                   )}
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                  <span className="flex items-center gap-1"><Flame size={10} className="text-emerald-500"/> {Math.round(log.kcal)}</span>
                  <span className="flex items-center gap-1"><Beef size={10} className="text-blue-500"/> {Math.round(log.p)}</span>
                  <span className="flex items-center gap-1"><Droplets size={10} className="text-yellow-500"/> {Math.round(log.f)}</span>
                  <span className="flex items-center gap-1"><Wheat size={10} className="text-rose-500"/> {Math.round(log.c)}</span>
                </div>
              </div>
              <button onClick={() => onDelete(log.id)} className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"><Trash2 size={18} /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ---------------- ADD MEAL MODAL ----------------

const AddMealModal = ({ onClose, currentDate, savedMeals, onDeleteSaved, onSaveLog, onSaveFavorite, onSuccess }: any) => {
  const [activeTab, setActiveTab] = useState<'create' | 'favorites' | 'manual'>('create');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<OpenFoodFactsProduct[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  
  const [addedIngredients, setAddedIngredients] = useState<Ingredient[]>([]);
  const [mealName, setMealName] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<OpenFoodFactsProduct | null>(null);
  const [amount, setAmount] = useState<string>('100');
  const [unit, setUnit] = useState<'g' | 'ml' | 'szt'>('g');

  const [manualForm, setManualForm] = useState({ name: '', kcal: '', p: '', f: '', c: '' });

  // Debounced Search with Better Logic
  useEffect(() => {
    if (searchTerm.length < 2) { setResults([]); return; }
    const tId = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const res = await fetch(`https://pl.openfoodfacts.org/cgi/search.pl?search_terms=${searchTerm}&search_simple=1&action=process&json=1&page_size=40`);
        const data = await res.json();
        let products = (data.products || []) as OpenFoodFactsProduct[];

        const lowerTerm = searchTerm.toLowerCase();
        
        // --- IMPROVED SORTING ---
        products.sort((a, b) => {
           const nA = (a.product_name_pl || a.product_name || '').toLowerCase();
           const nB = (b.product_name_pl || b.product_name || '').toLowerCase();
           
           // Exact match Priority
           const exactA = nA === lowerTerm;
           const exactB = nB === lowerTerm;
           if (exactA && !exactB) return -1;
           if (!exactA && exactB) return 1;

           // Starts with
           if (nA.startsWith(lowerTerm) && !nB.startsWith(lowerTerm)) return -1;
           if (!nA.startsWith(lowerTerm) && nB.startsWith(lowerTerm)) return 1;

           // Length (Shorter is usually raw product)
           return nA.length - nB.length;
        });

        // Dedup slightly
        const seen = new Set();
        products = products.filter(p => {
          const n = p.product_name_pl || p.product_name;
          if (!n || seen.has(n)) return false;
          seen.add(n);
          return true;
        });

        setResults(products.slice(0, 25));
      } catch (e) { console.error(e); } finally { setLoadingSearch(false); }
    }, 400);
    return () => clearTimeout(tId);
  }, [searchTerm]);

  const calculateMacros = (k: number, p: number, f: number, c: number, amt: number, u: string) => {
    const mult = (u === 'g' || u === 'ml') ? amt / 100 : amt;
    return { kcal: k * mult, p: p * mult, f: f * mult, c: c * mult };
  };

  const addIngredient = () => {
    if (!selectedProduct) return;
    const base = selectedProduct.nutriments;
    const macros = calculateMacros(
      base?.['energy-kcal_100g'] || 0, base?.proteins_100g || 0, base?.fat_100g || 0, base?.carbohydrates_100g || 0,
      parseFloat(amount) || 0, unit
    );
    setAddedIngredients([...addedIngredients, {
      name: selectedProduct.product_name_pl || selectedProduct.product_name || 'Produkt',
      amount: parseFloat(amount), unit, ...macros
    }]);
    setSelectedProduct(null);
    setAmount('100');
    setUnit('g');
  };

  const addManual = () => {
     if (!manualForm.name || !manualForm.kcal) return;
     setAddedIngredients([...addedIngredients, {
       name: manualForm.name, amount: 1, unit: 'porcja',
       kcal: parseFloat(manualForm.kcal), p: parseFloat(manualForm.p)||0, f: parseFloat(manualForm.f)||0, c: parseFloat(manualForm.c)||0
     }]);
     setManualForm({ name: '', kcal: '', p: '', f: '', c: '' });
     setActiveTab('create');
  };

  const handleFinish = async (favorite: boolean) => {
    const totals = addedIngredients.reduce((acc, c) => ({ kcal: acc.kcal+c.kcal, p: acc.p+c.p, f: acc.f+c.f, c: acc.c+c.c }), {kcal:0,p:0,f:0,c:0});
    const name = mealName || (addedIngredients.length === 1 ? addedIngredients[0].name : "Mój Posiłek");
    const payload = { name, ...totals, ingredients: addedIngredients, date: currentDate };
    
    await onSaveLog(payload);
    if (favorite) await onSaveFavorite(payload);
    onSuccess(favorite ? "Zapisano i dodano do ulubionych!" : "Dodano posiłek!");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-zinc-950 h-[95vh] sm:h-[90vh] rounded-t-3xl sm:rounded-2xl flex flex-col overflow-hidden border border-zinc-800 relative">
        <div className="px-5 py-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
          <div><h2 className="font-semibold text-lg">Kreator Posiłku</h2><p className="text-xs text-zinc-500">{addedIngredients.length} w koszyku</p></div>
          <button onClick={onClose} className="p-2 bg-zinc-800 rounded-full hover:bg-zinc-700"><X size={18} /></button>
        </div>

        <div className="flex border-b border-zinc-800 shrink-0">
          {['create', 'manual', 'favorites'].map(t => (
            <button key={t} onClick={() => {setActiveTab(t as any); setSelectedProduct(null)}} className={`flex-1 py-3 text-sm font-medium relative ${activeTab === t ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {t === 'create' ? 'Szukaj' : t === 'manual' ? 'Własny' : 'Ulubione'}
              {activeTab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 pb-40">
          {activeTab === 'create' && !selectedProduct && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-3.5 text-zinc-500" size={18} />
                <input type="text" autoFocus placeholder="Szukaj (np. Banan, Jajko...)" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 py-3 focus:border-emerald-500 outline-none text-white" />
                {loadingSearch && <Loader2 className="absolute right-3 top-3.5 animate-spin text-emerald-500" size={18} />}
              </div>
              <div className="space-y-2">
                  {results.map((item, i) => (
                    <button key={i} onClick={() => setSelectedProduct(item)} className="w-full text-left p-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 flex justify-between items-center group">
                      <div className="flex-1 overflow-hidden">
                         <div className="font-medium text-zinc-200 truncate group-hover:text-emerald-400">{item.product_name_pl || item.product_name}</div>
                         {item.brands && <div className="text-[10px] text-zinc-500 truncate">{item.brands}</div>}
                      </div>
                      <div className="text-xs font-bold text-zinc-400 whitespace-nowrap ml-2">{item.nutriments?.['energy-kcal_100g']} kcal/100g</div>
                    </button>
                  ))}
                  {results.length === 0 && searchTerm.length > 2 && !loadingSearch && <div className="text-center text-zinc-500 py-4">Brak wyników.</div>}
              </div>
            </div>
          )}

          {activeTab === 'create' && selectedProduct && (
            <div className="space-y-5 animate-in slide-in-from-right-8">
              <button onClick={() => setSelectedProduct(null)} className="text-xs text-zinc-500 flex items-center gap-1 hover:text-white"><ChevronRight className="rotate-180" size={14}/> Wróć</button>
              <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800">
                 <h3 className="font-bold text-lg text-emerald-400 mb-2">{selectedProduct.product_name_pl || selectedProduct.product_name}</h3>
                 <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-xs text-zinc-500 block mb-1">Ilość</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white text-lg font-bold" /></div>
                    <div><label className="text-xs text-zinc-500 block mb-1">Jednostka</label><div className="flex rounded-lg bg-zinc-950 border border-zinc-700 p-1 h-[54px]">{['g', 'ml', 'szt'].map(u => <button key={u} onClick={() => setUnit(u as any)} className={`flex-1 rounded text-xs font-medium ${unit === u ? 'bg-zinc-700 text-white' : 'text-zinc-500'}`}>{u}</button>)}</div></div>
                 </div>
              </div>
              <div className="bg-zinc-900/50 p-4 rounded-xl flex justify-around text-center">
                  {(() => {
                    const v = calculateMacros(selectedProduct.nutriments?.['energy-kcal_100g']||0, selectedProduct.nutriments?.proteins_100g||0, selectedProduct.nutriments?.fat_100g||0, selectedProduct.nutriments?.carbohydrates_100g||0, parseFloat(amount)||0, unit);
                    return <><div className="text-center"><div className="text-emerald-500 font-bold">{Math.round(v.kcal)}</div><div className="text-[10px] text-zinc-500">kcal</div></div><div className="text-center"><div className="text-blue-500 font-bold">{Math.round(v.p)}</div><div className="text-[10px] text-zinc-500">B</div></div><div className="text-center"><div className="text-yellow-500 font-bold">{Math.round(v.f)}</div><div className="text-[10px] text-zinc-500">T</div></div><div className="text-center"><div className="text-rose-500 font-bold">{Math.round(v.c)}</div><div className="text-[10px] text-zinc-500">W</div></div></>
                  })()}
              </div>
              <button onClick={addIngredient} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500">Dodaj do posiłku</button>
            </div>
          )}

          {activeTab === 'manual' && (
             <div className="space-y-4">
                <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 space-y-3">
                   <input type="text" placeholder="Nazwa" value={manualForm.name} onChange={e => setManualForm({...manualForm, name: e.target.value})} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white"/>
                   <div className="grid grid-cols-4 gap-2">
                      {['kcal', 'p', 'f', 'c'].map(f => <div key={f}><label className={`text-xs block text-center font-bold mb-1 uppercase ${f==='kcal'?'text-emerald-500':f==='p'?'text-blue-500':f==='f'?'text-yellow-500':'text-rose-500'}`}>{f}</label><input type="number" value={(manualForm as any)[f]} onChange={e => setManualForm({...manualForm, [f]: e.target.value})} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-center text-white"/></div>)}
                   </div>
                </div>
                <button onClick={addManual} className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-medium">Dodaj produkt</button>
             </div>
          )}

          {activeTab === 'favorites' && (
            <div className="space-y-3">
               {savedMeals.map((meal: SavedMeal) => (
                 <div key={meal.id} className="flex items-center gap-2">
                     <button onClick={() => {
                       const ings = meal.ingredients || [{name: meal.name, kcal: meal.kcal, p: meal.p, f: meal.f, c: meal.c, amount: 1, unit: 'porcja'}];
                       setAddedIngredients([...addedIngredients, ...ings]);
                       onSuccess("Dodano z ulubionych");
                     }} className="flex-1 text-left bg-zinc-900 p-3 rounded-xl border border-zinc-800 hover:border-emerald-500/50 transition-all">
                        <div className="flex justify-between items-center"><span className="font-medium text-zinc-200">{meal.name}</span><span className="text-sm font-bold text-zinc-100">{Math.round(meal.kcal)} kcal</span></div>
                     </button>
                     <button onClick={() => onDeleteSaved(meal.id)} className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-600 hover:text-red-500"><Trash2 size={18} /></button>
                 </div>
               ))}
               {savedMeals.length === 0 && <div className="text-center text-zinc-500 py-8">Brak ulubionych</div>}
            </div>
          )}
        </div>

        {addedIngredients.length > 0 && !selectedProduct && activeTab !== 'favorites' && (
          <div className="absolute bottom-0 left-0 right-0 bg-zinc-900 border-t border-emerald-500/30 rounded-t-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.5)] p-5 animate-in slide-in-from-bottom-full duration-300 z-10">
             <div className="flex justify-between items-center mb-3">
               <h3 className="font-bold text-zinc-200 flex items-center gap-2"><ShoppingBag size={18} className="text-emerald-500"/> Twój Posiłek</h3>
               <div className="text-emerald-400 font-bold text-lg">{Math.round(addedIngredients.reduce((a,c)=>a+c.kcal,0))} kcal</div>
             </div>
             <div className="flex gap-2 overflow-x-auto pb-2 mb-3 custom-scrollbar">
                {addedIngredients.map((ing, i) => (
                   <div key={i} className="flex-shrink-0 bg-zinc-950 border border-zinc-800 px-3 py-2 rounded-lg flex items-center gap-2">
                      <div><div className="text-xs font-medium text-zinc-300">{ing.name}</div><div className="text-[10px] text-zinc-500">{ing.amount} {ing.unit}</div></div>
                      <button onClick={() => setAddedIngredients(addedIngredients.filter((_, idx)=>idx!==i))} className="text-zinc-600 hover:text-red-500"><X size={14} /></button>
                   </div>
                ))}
             </div>
             <input type="text" placeholder="Nazwij posiłek (np. Owsianka)" value={mealName} onChange={e => setMealName(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-lg px-3 py-2 mb-3 focus:border-emerald-500 outline-none text-white" />
             <div className="grid grid-cols-2 gap-3">
               <button onClick={() => handleFinish(true)} className="py-2.5 rounded-lg border border-emerald-600/50 text-emerald-500 text-xs font-bold uppercase hover:bg-emerald-500/10">Zapisz Ulubiony</button>
               <button onClick={() => handleFinish(false)} className="py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-bold uppercase hover:bg-emerald-500 shadow-lg">Dodaj do Dziennika</button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------- HISTORY VIEW ----------------

const HistoryView = ({ allLogs, targets }: any) => {
  const grouped = useMemo(() => {
    const g: any = {};
    allLogs.forEach((l: DailyLog) => {
      if (!g[l.date]) g[l.date] = { logs: [], total: 0 };
      g[l.date].logs.push(l);
      g[l.date].total += l.kcal;
    });
    return Object.entries(g).sort((a: any, b: any) => b[0].localeCompare(a[0]));
  }, [allLogs]);

  return (
    <div className="p-4 space-y-6 animate-in fade-in duration-500">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent mt-2">Historia</h1>
      <div className="space-y-4">
        {grouped.length === 0 ? <div className="text-center py-20 text-zinc-600"><History className="mx-auto h-12 w-12 mb-3 opacity-30"/><p>Brak historii</p></div> :
          grouped.map(([date, data]: any) => {
            const pct = Math.round((data.total / targets.tdee) * 100);
            const color = pct > 105 ? "bg-red-500" : pct < 80 ? "bg-yellow-500" : "bg-emerald-500";
            return (
              <div key={date} className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-md">
                <div className="flex justify-between items-center mb-3">
                  <div className="font-medium text-zinc-200">{new Date(date).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                  <div className="text-sm text-zinc-500">{data.logs.length} posiłki</div>
                </div>
                <div className="flex items-end justify-between mb-2">
                  <div className="text-2xl font-bold text-white">{Math.round(data.total)} <span className="text-sm font-normal text-zinc-500">/ {targets.tdee}</span></div>
                  <div className={`text-xs font-bold px-2 py-1 rounded ${color} bg-opacity-20 text-${color.split('-')[1]}-400`}>{pct}%</div>
                </div>
                <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
};

// ---------------- PROFILE VIEW ----------------

const ProfileView = ({ stats, history, user, db, isDemoMode, onSave, onSuccess }: any) => {
  const [form, setForm] = useState({
    displayName: '', weight: 70, height: 175, age: 25, gender: 'male', activity: 1.2,
    proteinTarget: 140, fatTarget: 70, carbTarget: 250
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (stats) setForm(prev => ({ ...prev, ...stats }));
  }, [stats]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    const bmr = (10 * form.weight) + (6.25 * form.height) - (5 * form.age) + (form.gender === 'male' ? 5 : -161);
    const tdee = Math.round(bmr * form.activity);
    
    await onSave({
      date: new Date().toISOString().split('T')[0],
      ...form,
      tdee,
      proteinTarget: Number(form.proteinTarget),
      fatTarget: Number(form.fatTarget),
      carbTarget: Number(form.carbTarget)
    });
    setLoading(false);
  };

  const chartData = useMemo(() => [...history].reverse().map((h: any) => ({ date: new Date(h.date).toLocaleDateString('pl-PL', {month:'numeric', day:'numeric'}), weight: h.weight })), [history]);

  return (
    <div className="p-4 space-y-8 pb-24 animate-in fade-in duration-500">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent mt-2">Twój Profil</h1>

      {stats && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800"><div className="text-zinc-500 text-xs mb-1">TDEE</div><div className="text-2xl font-bold text-white flex gap-2"><Flame className="text-emerald-500"/> {stats.tdee}</div></div>
          <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800"><div className="text-zinc-500 text-xs mb-1">Waga</div><div className="text-2xl font-bold text-white flex gap-2"><Scale className="text-blue-500"/> {stats.weight}</div></div>
        </div>
      )}

      {chartData.length > 1 && (
        <div className="h-64 bg-zinc-900 rounded-2xl border border-zinc-800 p-4 pt-6">
          <h3 className="text-sm font-bold text-zinc-400 mb-4 flex gap-2"><TrendingUp size={16}/> Waga</h3>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false}/><XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false}/><YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} width={25}/><Tooltip contentStyle={{backgroundColor:'#18181b', borderColor:'#27272a', borderRadius:'8px'}} itemStyle={{color:'#10b981'}}/ ><Line type="monotone" dataKey="weight" stroke="#10b981" strokeWidth={3} dot={{r:3, fill:'#10b981'}} /></LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h3 className="text-lg font-bold text-zinc-200 mb-4">Ustawienia</h3>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div><label className="text-xs text-zinc-500 block mb-1">Nazwa</label><input type="text" value={form.displayName} onChange={e=>setForm({...form, displayName:e.target.value})} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2.5 text-white"/></div>
          <div className="grid grid-cols-2 gap-4">
             {['weight', 'height', 'age'].map(f => <div key={f}><label className="text-xs text-zinc-500 block mb-1 capitalize">{f === 'weight' ? 'Waga' : f === 'height' ? 'Wzrost' : 'Wiek'}</label><input type="number" value={(form as any)[f]} onChange={e=>setForm({...form, [f]:parseFloat(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2.5 text-white"/></div>)}
             <div><label className="text-xs text-zinc-500 block mb-1">Płeć</label><select value={form.gender} onChange={e=>setForm({...form, gender:e.target.value as any})} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2.5 text-white"><option value="male">Mężczyzna</option><option value="female">Kobieta</option></select></div>
          </div>
          <div><label className="text-xs text-zinc-500 block mb-1">Aktywność</label><select value={form.activity} onChange={e=>setForm({...form, activity:parseFloat(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2.5 text-white"><option value={1.2}>Brak (Siedzący)</option><option value={1.375}>Lekka</option><option value={1.55}>Średnia</option><option value={1.725}>Duża</option></select></div>
          
          <div className="pt-4 border-t border-zinc-800">
             <div className="flex justify-between mb-2"><span className="text-xs font-bold text-emerald-500 uppercase">Cele Makro</span><button type="button" onClick={()=>{
                const bmr = (10*form.weight)+(6.25*form.height)-(5*form.age)+(form.gender==='male'?5:-161);
                const tdee = Math.round(bmr*form.activity);
                setForm({...form, proteinTarget:Math.round(form.weight*2), fatTarget:Math.round(form.weight), carbTarget:Math.round((tdee-(form.weight*2*4)-(form.weight*9))/4)})
             }} className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded flex items-center gap-1"><RotateCcw size={10}/> Auto</button></div>
             <div className="grid grid-cols-3 gap-3">
               {['proteinTarget', 'fatTarget', 'carbTarget'].map(f => <div key={f}><label className={`text-xs block mb-1 text-center font-bold ${f.startsWith('p')?'text-blue-500':f.startsWith('f')?'text-yellow-500':'text-rose-500'}`}>{f[0].toUpperCase()}</label><input type="number" value={(form as any)[f]} onChange={e=>setForm({...form, [f]:parseFloat(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-center text-white"/></div>)}
             </div>
          </div>
          <button type="submit" disabled={loading} className="w-full py-3 bg-zinc-800 hover:bg-emerald-600 text-zinc-200 hover:text-white rounded-xl font-medium transition-all flex justify-center items-center gap-2">{loading?<Loader2 className="animate-spin"/>:<Save size={18}/>} Zapisz Profil</button>
        </form>
      </div>
    </div>
  );
};
