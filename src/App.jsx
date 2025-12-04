import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
  deleteDoc, doc, serverTimestamp, where
} from 'firebase/firestore';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Scale, Plus, Trash2, Utensils, Activity, 
  ChevronRight, Save, Search, Droplet, User, Calendar, Star, X, Check, History as HistoryIcon, Globe
} from 'lucide-react';

// --- KONFIGURACJA FIREBASE ---
// TE DANE MUSISZ UZUPEŁNIĆ ZE SWOJEJ KONSOLI FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBYDoWk4Yu4sksMTcDDEBxP6ySCBjGlXps",
  authDomain: "moja-dieta-dd762.firebaseapp.com",
  projectId: "moja-dieta-dd762",
  storageBucket: "moja-dieta-dd762.firebasestorage.app",
  messagingSenderId: "648341889890",
  appId: "1:648341889890:web:2698951380879f1e04023b"
};

// Inicjalizacja aplikacji
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Stała nazwa aplikacji dla bazy danych (nie zmieniaj tego)
const appId = 'fit-tracker-app';

// --- Funkcje pomocnicze ---
const formatDate = (date) => date.toISOString().split('T')[0];
const formatFloat = (num) => Math.round((num || 0) * 100) / 100;

const calculateBMR = (weight, height, age, gender, activity) => {
  let bmr = (10 * weight) + (6.25 * height) - (5 * age);
  bmr += gender === 'male' ? 5 : -161;
  const multipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
  return Math.round(bmr * (multipliers[activity] || 1.2));
};

const calculateMacros = (tdee) => ({
    p: Math.round((tdee * 0.25) / 4),
    f: Math.round((tdee * 0.30) / 9),
    c: Math.round((tdee * 0.45) / 4)
});

// --- Lokalna baza produktów (Startowa) ---
const MOCK_FOOD_DB = {
  'jajka': { kcal: 155, p: 13, f: 11, c: 1.1, unit: 'g' }, 
  'jajko': { kcal: 70, p: 6, f: 5, c: 0.5, unit: 'szt.' },
  'pierś z kurczaka': { kcal: 165, p: 31, f: 3.6, c: 0, unit: 'g' },
  'ryż biały': { kcal: 130, p: 2.7, f: 0.3, c: 28, unit: 'g' },
  'chleb razowy': { kcal: 250, p: 9, f: 1.5, c: 50, unit: 'g' },
  'banan': { kcal: 89, p: 1.1, f: 0.3, c: 23, unit: 'g' },
  'jabłko': { kcal: 52, p: 0.3, f: 0.2, c: 14, unit: 'g' },
  'mleko 2%': { kcal: 50, p: 3.4, f: 2, c: 4.8, unit: 'ml' },
  'płatki owsiane': { kcal: 389, p: 16.9, f: 6.9, c: 66, unit: 'g' },
  'twaróg półtłusty': { kcal: 133, p: 18, f: 4, c: 3.5, unit: 'g' },
  'oliwa z oliwek': { kcal: 884, p: 0, f: 100, c: 0, unit: 'ml' },
};

// --- Funkcja szukania w Internecie (OpenFoodFacts API) ---
const searchProductInAPI = async (term) => {
    if (term.length < 3) return [];
    try {
        const response = await fetch(`https://pl.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=5`);
        const data = await response.json();
        
        return data.products.map(p => ({
            name: p.product_name,
            brand: typeof p.brands === 'string' ? p.brands : '',
            kcal: p.nutriments['energy-kcal_100g'] || 0,
            p: p.nutriments.proteins_100g || 0,
            f: p.nutriments.fat_100g || 0,
            c: p.nutriments.carbohydrates_100g || 0,
            unit: 'g', // API zawsze zwraca dane na 100g/ml
            source: 'api'
        })).filter(item => item.kcal > 0);
    } catch (error) {
        console.error("API Error:", error);
        return [];
    }
};

// --- Komponenty ---

const Loading = () => (
  <div className="flex h-screen w-full items-center justify-center bg-gray-900 text-emerald-500">
    <Activity className="h-10 w-10 animate-spin" />
    <span className="ml-3 text-lg font-mono">Ładowanie...</span>
  </div>
);

const TabButton = ({ active, icon: Icon, label, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center justify-center w-full py-3 transition-colors ${
      active ? 'text-emerald-400 bg-gray-800' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
    }`}
  >
    <Icon className="h-6 w-6 mb-1" />
    <span className="text-xs font-medium">{label}</span>
  </button>
);

// --- Główna Aplikacja ---
export default function FitTracker() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('diary');
  const [date, setDate] = useState(formatDate(new Date()));
  const [loading, setLoading] = useState(true);

  // Stany danych
  const [logs, setLogs] = useState([]);
  const [allHistoryLogs, setAllHistoryLogs] = useState([]);
  const [weightHistory, setWeightHistory] = useState([]);
  const [savedMeals, setSavedMeals] = useState([]);
  const [latestProfile, setLatestProfile] = useState(null);

  // Logowanie (Anonimowe)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoading(false);
      } else {
        signInAnonymously(auth).catch((error) => {
            console.error("Błąd logowania:", error);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Pobieranie danych z Firestore
  useEffect(() => {
    if (!user) return;
    const baseUserPath = ['artifacts', appId, 'users', user.uid];

    // 1. Dziennik na dziś
    const logsQ = query(collection(db, ...baseUserPath, 'daily_logs'), where('date', '==', date));
    const unsubLogs = onSnapshot(logsQ, (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Sortowanie lokalne
        data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setLogs(data);
    });

    // 2. Ulubione posiłki
    const savedQ = query(collection(db, ...baseUserPath, 'saved_meals'), orderBy('createdAt', 'desc'));
    const unsubSaved = onSnapshot(savedQ, (snap) => setSavedMeals(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    // 3. Profil i waga
    const profileQ = query(collection(db, ...baseUserPath, 'user_stats'), orderBy('date', 'asc'));
    const unsubProfile = onSnapshot(profileQ, (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setWeightHistory(data);
        if (data.length > 0) setLatestProfile(data[data.length - 1]);
    });

    // 4. Historia (tylko gdy widok to historia)
    let unsubHistory = () => {};
    if (view === 'history') {
        const historyQ = query(collection(db, ...baseUserPath, 'daily_logs'), orderBy('date', 'desc'));
        unsubHistory = onSnapshot(historyQ, (snap) => {
             const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
             setAllHistoryLogs(data);
        });
    }

    return () => { unsubLogs(); unsubProfile(); unsubSaved(); unsubHistory(); };
  }, [user, date, view]);

  // --- Funkcje zapisu do bazy ---
  const addLog = async (name, kcal, p, f, c) => {
    if (!user) return;
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'daily_logs'), {
      date, name, kcal: Number(kcal), p: Number(p), f: Number(f), c: Number(c), createdAt: serverTimestamp()
    });
  };

  const saveMealFavorite = async (name, kcal, p, f, c) => {
    if (!user) return;
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'saved_meals'), {
        name, kcal: Number(kcal), p: Number(p), f: Number(f), c: Number(c), createdAt: serverTimestamp()
    });
  };

  const deleteSavedMeal = async (id) => await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'saved_meals', id));
  const deleteLog = async (id) => await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'daily_logs', id));

  const updateProfile = async (weight, height, age, gender, activity) => {
    if (!user) return;
    const tdee = calculateBMR(Number(weight), Number(height), Number(age), gender, activity);
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'user_stats'), {
      date: formatDate(new Date()), weight: Number(weight), height: Number(height), age: Number(age),
      gender, activity, tdee, createdAt: serverTimestamp()
    });
  };

  if (loading) return <Loading />;

  const tdee = latestProfile?.tdee || 2000;
  const macroTargets = calculateMacros(tdee);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex flex-col max-w-md mx-auto shadow-2xl overflow-hidden border-x border-gray-800">
      
      {/* Górny pasek */}
      <header className="bg-gray-900 p-4 flex items-center justify-between border-b border-gray-800 sticky top-0 z-10">
        <div className="flex items-center space-x-2">
            <Activity className="text-emerald-500 h-6 w-6" />
            <h1 className="text-xl font-bold tracking-tight text-white">Fit<span className="text-emerald-500">Plan</span></h1>
        </div>
        {view === 'diary' && (
            <div className="flex items-center bg-gray-800 rounded-lg px-2 py-1 border border-gray-700">
                <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="bg-transparent text-sm text-gray-200 focus:outline-none w-28" />
            </div>
        )}
      </header>

      {/* Główna treść */}
      <main className="flex-1 overflow-y-auto scrollbar-hide">
        {view === 'diary' && (
            <DiaryView 
                logs={logs} 
                savedMeals={savedMeals}
                onAdd={addLog} 
                onSaveFavorite={saveMealFavorite}
                onDeleteFavorite={deleteSavedMeal}
                onDelete={deleteLog} 
                target={tdee} 
                macroTargets={macroTargets} 
            />
        )}
        {view === 'history' && <HistoryView logs={allHistoryLogs} target={tdee} />}
        {view === 'profile' && <ProfileView history={weightHistory} onUpdate={updateProfile} current={latestProfile} />}
      </main>

      {/* Dolny pasek nawigacji */}
      <nav className="bg-gray-900 border-t border-gray-800 flex justify-around shrink-0 pb-safe">
        <TabButton active={view === 'diary'} icon={Utensils} label="Dziennik" onClick={() => setView('diary')} />
        <TabButton active={view === 'history'} icon={HistoryIcon} label="Historia" onClick={() => setView('history')} />
        <TabButton active={view === 'profile'} icon={User} label="Profil" onClick={() => setView('profile')} />
      </nav>
    </div>
  );
}

// --- Pod-komponenty ---

function HistoryView({ logs, target }) {
    const historyData = logs.reduce((acc, log) => {
        if (!acc[log.date]) {
            acc[log.date] = { kcal: 0, p: 0, f: 0, c: 0, items: [] };
        }
        acc[log.date].kcal += log.kcal;
        acc[log.date].p += log.p;
        acc[log.date].f += log.f;
        acc[log.date].c += log.c;
        acc[log.date].items.push(log);
        return acc;
    }, {});

    const sortedDates = Object.keys(historyData).sort((a, b) => new Date(b) - new Date(a));

    return (
        <div className="p-4 space-y-4">
            <h2 className="text-xl font-bold text-white mb-2">Historia Dni</h2>
            {sortedDates.length === 0 && <p className="text-gray-500 text-center py-10">Brak historii.</p>}
            
            {sortedDates.map(day => {
                const dayData = historyData[day];
                const percent = Math.min(100, (dayData.kcal / target) * 100);
                let barColor = 'bg-emerald-500';
                if (percent > 105) barColor = 'bg-red-500';
                else if (percent < 80) barColor = 'bg-yellow-500';

                return (
                    <div key={day} className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-white">{day}</span>
                            <span className={`text-xs font-bold px-2 py-1 rounded ${percent > 100 ? 'bg-red-900/30 text-red-400' : 'bg-emerald-900/30 text-emerald-400'}`}>
                                {Math.round(percent)}% Celu
                            </span>
                        </div>
                        <div className="flex justify-between items-end mb-2">
                             <div>
                                <span className="text-2xl font-bold text-gray-200">{Math.round(dayData.kcal)}</span>
                                <span className="text-xs text-gray-500 ml-1">/ {target} kcal</span>
                             </div>
                             <div className="text-xs text-gray-400 space-x-2">
                                <span className="text-blue-400">B: {Math.round(dayData.p)}</span>
                                <span className="text-yellow-400">T: {Math.round(dayData.f)}</span>
                                <span className="text-purple-400">W: {Math.round(dayData.c)}</span>
                             </div>
                        </div>
                        <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor}`} style={{ width: `${percent}%` }}></div>
                        </div>
                    </div>
                )
            })}
        </div>
    );
}

function DiaryView({ logs, savedMeals, onAdd, onSaveFavorite, onDeleteFavorite, onDelete, target, macroTargets }) {
  const [isAdding, setIsAdding] = useState(false);
  const [activeTab, setActiveTab] = useState('create'); 
  
  // Kreator posiłków
  const [mealName, setMealName] = useState('');
  const [ingredients, setIngredients] = useState([]); 
  
  // Input dla pojedynczego składnika
  const [ingName, setIngName] = useState('');
  const [ingCount, setIngCount] = useState(1);
  const [ingUnit, setIngUnit] = useState('g');
  const [ingData, setIngData] = useState({ kcal: 0, p: 0, f: 0, c: 0 }); 
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Podsumowania
  const dailyTotals = logs.reduce((acc, log) => ({
    kcal: acc.kcal + (log.kcal || 0),
    p: acc.p + (log.p || 0),
    f: acc.f + (log.f || 0),
    c: acc.c + (log.c || 0),
  }), { kcal: 0, p: 0, f: 0, c: 0 });

  const calculateItemTotal = (item) => {
      const multiplier = (item.unit === 'g' || item.unit === 'ml') ? (item.count / 100) : item.count;
      return {
          kcal: item.kcal * multiplier,
          p: item.p * multiplier,
          f: item.f * multiplier,
          c: item.c * multiplier
      };
  };

  const builderTotals = ingredients.reduce((acc, item) => {
      const totals = calculateItemTotal(item);
      return {
          kcal: acc.kcal + totals.kcal,
          p: acc.p + totals.p,
          f: acc.f + totals.f,
          c: acc.c + totals.c,
      };
  }, { kcal: 0, p: 0, f: 0, c: 0 });

  const remaining = formatFloat(target - dailyTotals.kcal);

  // Szukanie API z opóźnieniem (debounce)
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (ingName.length >= 3 && activeTab === 'create') {
        if (!MOCK_FOOD_DB[ingName.toLowerCase()]) {
            setIsSearching(true);
            const results = await searchProductInAPI(ingName);
            setSearchResults(results);
            setIsSearching(false);
        } else {
            setSearchResults([]);
        }
      } else {
        setSearchResults([]);
      }
    }, 600);
    return () => clearTimeout(delayDebounceFn);
  }, [ingName, activeTab]);

  // Szukanie w lokalnej bazie
  useEffect(() => {
     const lowerVal = ingName.toLowerCase().trim();
     if (MOCK_FOOD_DB[lowerVal]) {
         const item = MOCK_FOOD_DB[lowerVal];
         setIngData({ kcal: item.kcal, p: item.p, f: item.f, c: item.c });
         setIngUnit(item.unit || 'g');
     }
  }, [ingName]);

  const selectSearchResult = (item) => {
    setIngName(item.name);
    setIngData({ kcal: item.kcal, p: item.p, f: item.f, c: item.c });
    setIngUnit('g');
    setSearchResults([]);
  };

  const addIngredient = () => {
      if (!ingName) return;
      setIngredients([...ingredients, {
          id: Date.now(),
          name: ingName,
          count: Number(ingCount),
          unit: ingUnit,
          ...ingData
      }]);
      setIngName('');
      setIngCount(1);
      setIngData({ kcal: 0, p: 0, f: 0, c: 0 });
      setIngUnit('g');
      setSearchResults([]);
  };

  const removeIngredient = (id) => setIngredients(ingredients.filter(i => i.id !== id));

  const handleSaveMeal = (shouldSaveAsFavorite = false) => {
      if (ingredients.length === 0) return;
      let finalName = mealName.trim();
      if (!finalName) {
          finalName = ingredients.map(i => `${i.name} ${i.unit === 'g' || i.unit === 'ml' ? `(${i.count}${i.unit})` : `(x${i.count})`}`).join(', ');
      }
      onAdd(finalName, builderTotals.kcal, builderTotals.p, builderTotals.f, builderTotals.c);
      if (shouldSaveAsFavorite) onSaveFavorite(finalName, builderTotals.kcal, builderTotals.p, builderTotals.f, builderTotals.c);
      setIsAdding(false);
      setIngredients([]);
      setMealName('');
  };

  return (
    <div className="p-4 space-y-6">
      {/* Podsumowanie */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 shadow-lg">
        <div className="flex justify-between items-end mb-4">
          <div>
            <p className="text-gray-400 text-sm font-medium uppercase tracking-wider">Pozostało</p>
            <h2 className={`text-4xl font-bold ${remaining < 0 ? 'text-red-500' : 'text-emerald-400'}`}>
              {remaining} <span className="text-lg text-gray-500 font-normal">kcal</span>
            </h2>
          </div>
          <div className="text-right">
            <p className="text-gray-500 text-xs">Cel: {target}</p>
            <p className="text-gray-500 text-xs">Zjedzone: {formatFloat(dailyTotals.kcal)}</p>
          </div>
        </div>
        <div className="space-y-3">
            <MacroRow label="Białko" current={dailyTotals.p} target={macroTargets.p} color="bg-blue-500" />
            <MacroRow label="Tłuszcze" current={dailyTotals.f} target={macroTargets.f} color="bg-yellow-500" />
            <MacroRow label="Węglow." current={dailyTotals.c} target={macroTargets.c} color="bg-purple-500" />
        </div>
      </div>

      {/* Przyciski Dodawania */}
      {!isAdding ? (
        <button 
          onClick={() => setIsAdding(true)}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold shadow-lg shadow-emerald-900/50 flex items-center justify-center transition-all"
        >
          <Plus className="mr-2" /> Dodaj Posiłek
        </button>
      ) : (
        <div className="bg-gray-800 rounded-xl p-1 border border-gray-700 animate-in fade-in zoom-in duration-200 overflow-hidden">
            <div className="flex bg-gray-900 p-1 rounded-t-lg">
                <button onClick={() => setActiveTab('create')} className={`flex-1 py-2 text-sm font-medium rounded-md flex justify-center items-center ${activeTab === 'create' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>
                   <Plus className="w-3 h-3 mr-1"/> Nowy
                </button>
                <button onClick={() => setActiveTab('favorites')} className={`flex-1 py-2 text-sm font-medium rounded-md flex justify-center items-center ${activeTab === 'favorites' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>
                    <Star className="w-3 h-3 mr-1" /> Ulubione
                </button>
            </div>

            <div className="p-4">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-bold text-gray-400 uppercase">
                        {activeTab === 'create' ? 'Tworzenie posiłku' : 'Wybierz z listy'}
                    </h3>
                    <button onClick={() => setIsAdding(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5"/></button>
                </div>

                {activeTab === 'create' ? (
                    <>
                    <input 
                        className="bg-transparent text-lg font-bold text-emerald-400 focus:outline-none w-full placeholder-gray-500 mb-4"
                        value={mealName}
                        onChange={(e) => setMealName(e.target.value)}
                        placeholder="Nazwa (np. Śniadanie)"
                    />

                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 mb-3 relative">
                        <div className="flex gap-2 mb-2 items-center">
                            <div className="relative flex-1">
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="Szukaj (np. Jajka, Płatki)" 
                                        value={ingName}
                                        onChange={(e) => setIngName(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-8 text-sm text-white focus:border-emerald-500 focus:outline-none"
                                    />
                                    <Search className="w-4 h-4 text-gray-500 absolute left-2 top-2.5" />
                                    {isSearching && <Activity className="w-4 h-4 text-emerald-500 absolute right-2 top-2.5 animate-spin" />}
                                </div>
                                
                                {searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                                        <div className="p-2 text-xs text-gray-500 font-bold bg-gray-900 flex items-center">
                                            <Globe className="w-3 h-3 mr-1" /> Wyniki z Internetu
                                        </div>
                                        {searchResults.map((item, idx) => (
                                            <div 
                                                key={idx}
                                                onClick={() => selectSearchResult(item)}
                                                className="p-2 hover:bg-emerald-900/30 cursor-pointer border-b border-gray-700/50 last:border-0"
                                            >
                                                <div className="text-sm text-white font-medium">{item.name}</div>
                                                <div className="text-xs text-gray-400 flex gap-2">
                                                    {item.brand && <span className="text-emerald-400">{item.brand}</span>}
                                                    <span>{Math.round(item.kcal)} kcal / 100g</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            
                            <input 
                                type="number" 
                                value={ingCount}
                                min="0.1"
                                step="0.5"
                                onChange={(e) => setIngCount(e.target.value)}
                                className="w-16 bg-gray-800 border border-gray-600 rounded p-2 text-sm text-center text-white focus:border-emerald-500 focus:outline-none"
                            />

                            <select 
                                value={ingUnit} 
                                onChange={(e) => setIngUnit(e.target.value)}
                                className="bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                            >
                                <option value="g">g</option>
                                <option value="ml">ml</option>
                                <option value="szt.">szt.</option>
                            </select>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-2 mb-2">
                            <input type="number" step="0.01" placeholder="Kcal" value={ingData.kcal || ''} onChange={e => setIngData({...ingData, kcal: Number(e.target.value)})} className="bg-gray-800 border-b border-gray-600 p-1 text-xs text-center text-gray-300 focus:outline-none" />
                            <input type="number" step="0.01" placeholder="B" value={ingData.p || ''} onChange={e => setIngData({...ingData, p: Number(e.target.value)})} className="bg-gray-800 border-b border-gray-600 p-1 text-xs text-center text-blue-300 focus:outline-none" />
                            <input type="number" step="0.01" placeholder="T" value={ingData.f || ''} onChange={e => setIngData({...ingData, f: Number(e.target.value)})} className="bg-gray-800 border-b border-gray-600 p-1 text-xs text-center text-yellow-300 focus:outline-none" />
                            <input type="number" step="0.01" placeholder="W" value={ingData.c || ''} onChange={e => setIngData({...ingData, c: Number(e.target.value)})} className="bg-gray-800 border-b border-gray-600 p-1 text-xs text-center text-purple-300 focus:outline-none" />
                        </div>
                        <div className="text-[10px] text-gray-500 text-center mb-2 italic">
                            {ingUnit === 'szt.' ? '* Wartości dla 1 sztuki' : '* Wartości dla 100g/ml'}
                        </div>
                        <button onClick={addIngredient} className="w-full bg-gray-700 hover:bg-gray-600 py-1 rounded text-xs text-gray-200 font-medium">
                            + Dodaj Składnik
                        </button>
                    </div>

                    <div className="space-y-1 mb-4 max-h-32 overflow-y-auto">
                        {ingredients.map(ing => {
                            const totals = calculateItemTotal(ing);
                            return (
                                <div key={ing.id} className="flex justify-between items-center text-sm p-2 bg-gray-900 rounded border border-gray-800">
                                    <span>{ing.name} <span className="text-emerald-500 font-bold">{ing.count} {ing.unit}</span></span>
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-gray-500">{formatFloat(totals.kcal)} kcal</span>
                                        <button onClick={() => removeIngredient(ing.id)} className="text-red-400 hover:text-red-300"><X className="w-3 h-3"/></button>
                                    </div>
                                </div>
                            )
                        })}
                        {ingredients.length === 0 && <p className="text-xs text-gray-500 text-center italic">Dodaj składniki powyżej</p>}
                    </div>

                    <div className="border-t border-gray-700 pt-3">
                        <div className="flex justify-between text-sm mb-3 font-bold text-gray-300">
                            <span>Razem:</span>
                            <span>{formatFloat(builderTotals.kcal)} kcal</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => handleSaveMeal(false)} className="w-full bg-emerald-600 py-3 rounded-lg font-bold text-white text-sm flex justify-center items-center">
                                <Check className="w-4 h-4 mr-2" /> Dodaj do dziennika
                            </button>
                            <button onClick={() => handleSaveMeal(true)} className="w-full bg-gray-700 hover:bg-yellow-900/50 text-yellow-500 py-2 rounded-lg text-xs font-medium flex justify-center items-center transition-colors">
                                <Star className="w-3 h-3 mr-2" /> Dodaj i zapisz jako ulubiony
                            </button>
                        </div>
                    </div>
                    </>
                ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {savedMeals.length === 0 && <p className="text-gray-500 text-sm text-center py-10">Brak ulubionych posiłków.</p>}
                        {savedMeals.map(meal => (
                            <div key={meal.id} className="flex flex-col bg-gray-900 p-3 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-bold text-emerald-400">{meal.name}</span>
                                    <button onClick={() => onDeleteFavorite(meal.id)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-4 h-4"/></button>
                                </div>
                                <div className="flex justify-between items-center text-sm text-gray-300">
                                    <div className="space-x-2 text-xs">
                                        <span className="text-white font-bold">{formatFloat(meal.kcal)} kcal</span>
                                        <span className="text-blue-400">B:{formatFloat(meal.p)}</span>
                                        <span className="text-yellow-400">T:{formatFloat(meal.f)}</span>
                                        <span className="text-purple-400">W:{formatFloat(meal.c)}</span>
                                    </div>
                                    <button 
                                        onClick={() => { onAdd(meal.name, meal.kcal, meal.p, meal.f, meal.c); setIsAdding(false); }}
                                        className="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-white px-3 py-1 rounded-full text-xs font-bold transition-all"
                                    >
                                        DODAJ +
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-3 pb-20">
        {logs.length === 0 && (
            <div className="text-center text-gray-600 py-10 italic">Brak wpisów na dzisiaj</div>
        )}
        {logs.map((log) => (
            <div key={log.id} className="flex items-center justify-between bg-gray-900/50 p-4 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors">
                <div>
                    <h4 className="font-medium text-gray-200">{log.name}</h4>
                    <div className="text-xs text-gray-500 mt-1 flex space-x-2">
                        <span className="text-emerald-500 font-bold">{formatFloat(log.kcal)} kcal</span>
                        <span className="text-blue-400/70">B: {formatFloat(log.p)}</span>
                        <span className="text-yellow-400/70">T: {formatFloat(log.f)}</span>
                        <span className="text-purple-400/70">W: {formatFloat(log.c)}</span>
                    </div>
                </div>
                <button 
                    onClick={() => onDelete(log.id)}
                    className="p-2 text-gray-600 hover:text-red-400 transition-colors"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>
        ))}
      </div>
    </div>
  );
}

function MacroRow({ label, current, target, color }) {
    const percent = Math.min(100, (current / target) * 100) || 0;
    return (
        <div className="flex items-center text-xs">
            <div className="w-16 font-bold text-gray-400">{label}</div>
            <div className="flex-1 mx-2">
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color}`} style={{ width: `${percent}%` }}></div>
                </div>
            </div>
            <div className="w-20 text-right text-gray-300">
                {formatFloat(current)} / <span className="text-gray-500">{target}g</span>
            </div>
        </div>
    )
}

function ProfileView({ history, onUpdate, current }) {
    const [w, setW] = useState(current?.weight || '');
    const [h, setH] = useState(current?.height || '');
    const [a, setA] = useState(current?.age || '');
    const [g, setG] = useState(current?.gender || 'female');
    const [act, setAct] = useState(current?.activity || 'sedentary');
    const [msg, setMsg] = useState('');

    const handleUpdate = (e) => {
        e.preventDefault();
        onUpdate(w, h, a, g, act);
        setMsg('Zaktualizowano plan!');
        setTimeout(() => setMsg(''), 3000);
    };

    return (
        <div className="p-4 space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-lg h-64">
                <h3 className="text-sm font-medium text-gray-400 mb-4 ml-2">Historia Wagi</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                        <XAxis dataKey="date" stroke="#6B7280" fontSize={10} tickFormatter={(d) => d.slice(5)} />
                        <YAxis stroke="#6B7280" fontSize={10} domain={['auto', 'auto']} />
                        <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#F3F4F6' }} />
                        <Line type="monotone" dataKey="weight" stroke="#10B981" strokeWidth={2} dot={{ r: 4, fill: '#10B981' }} activeDot={{ r: 6 }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <form onSubmit={handleUpdate} className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
                <h3 className="text-lg font-bold text-white flex items-center">
                    <Scale className="mr-2 h-5 w-5 text-emerald-500" /> Aktualizacja Tygodniowa
                </h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Waga (kg)</label>
                        <input type="number" value={w} onChange={e => setW(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-emerald-500 focus:outline-none" required />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Wzrost (cm)</label>
                        <input type="number" value={h} onChange={e => setH(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-emerald-500 focus:outline-none" required />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Wiek</label>
                        <input type="number" value={a} onChange={e => setA(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-emerald-500 focus:outline-none" required />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Płeć</label>
                        <select value={g} onChange={e => setG(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-emerald-500 focus:outline-none">
                            <option value="female">Kobieta</option>
                            <option value="male">Mężczyzna</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Aktywność</label>
                    <select value={act} onChange={e => setAct(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-emerald-500 focus:outline-none text-sm">
                        <option value="sedentary">Mała (biurowa)</option>
                        <option value="light">Lekka (1-3 treningi)</option>
                        <option value="moderate">Średnia (3-5 treningów)</option>
                        <option value="active">Duża (6-7 treningów)</option>
                    </select>
                </div>
                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 mt-2">
                    Przelicz i Zapisz
                </button>
                {msg && <p className="text-center text-emerald-400 text-sm mt-2">{msg}</p>}
            </form>
        </div>
    );
}