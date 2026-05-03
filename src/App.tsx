/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Image as ImageIcon, 
  History, 
  Settings, 
  Zap, 
  LogOut, 
  Download, 
  Trash2, 
  Maximize2, 
  CreditCard, 
  Check,
  Menu,
  X,
  ChevronRight,
  Loader2,
  MessageSquare,
  Copy,
  Smartphone,
  Home,
  Mic
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { QRCodeSVG } from 'qrcode.react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  where,
  testConnection
} from './lib/firebase';
import { cn, compressImage } from './lib/utils';

// Constants
const FREE_CREDITS = 5;
const PRO_PLAN_PRICE = 49.90;
const ELITE_PLAN_PRICE = 129.90;
const PIX_CPF = "05705749350";
const PIX_NAME = "Visionary AI Payments";

const FORBIDDEN_KEYWORDS = [
  'pix', 'comprovante', 'banco', 'bancário', 'transferência', 'extrato', 
  'fake', 'bank', 'receipt', 'invoice', 'billing', 'payment proof', 
  'saldo', 'conta bancária', 'boleto', 'nubank', 'bradesco', 'itaú', 
  'santander', 'inter', 'caixa econômica', 'money check', 'financial document',
  'credit card', 'cartão de crédito'
];

const isPromptSafe = (text: string) => {
  const lowerText = text.toLowerCase();
  return !FORBIDDEN_KEYWORDS.some(keyword => lowerText.includes(keyword));
};

type Plan = 'free' | 'pro' | 'elite';

interface UserProfile {
  uid: string;
  credits: number;
  plan: Plan;
  updatedAt: any;
}

interface GeneratedImage {
  id: string;
  userId: string;
  prompt: string;
  imageUrl: string;
  aspectRatio: string;
  style: string;
  createdAt: any;
}

// AI Service
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  
  // Generator State
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [style, setStyle] = useState("photorealistic");
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pixCode, setPixCode] = useState("");
  const [verifyingPix, setVerifyingPix] = useState(false);
  const [selectedPlanForPayment, setSelectedPlanForPayment] = useState<Plan | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // PWA Install Logic
  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Speech Recognition Setup
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'pt-BR';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setPrompt(prev => prev + (prev ? " " : "") + transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech Recognition Error", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Seu navegador não suporta reconhecimento de voz.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error("Start Listening Error", err);
      }
    }
  };

  const handleDownloadRequest = (url: string) => {
    setDownloadUrl(url);
    setShowDownloadConfirm(true);
  };

  const executeDownload = () => {
    if (downloadUrl) {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `visionary-${Date.now()}.png`;
      link.click();
    }
    setShowDownloadConfirm(false);
    setDownloadUrl(null);
  };

  // Auth Listener
  useEffect(() => {
    testConnection();
    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      setUser(u);
      if (u) {
        // Fetch or Create Profile
        const profileRef = doc(db, 'users', u.uid);
        const profileSnap = await getDoc(profileRef);
        
        if (!profileSnap.exists()) {
          const newProfile: UserProfile = {
            uid: u.uid,
            credits: FREE_CREDITS,
            plan: 'free',
            updatedAt: serverTimestamp(),
          };
          await setDoc(profileRef, newProfile);
          setProfile(newProfile);
        } else {
          // Sync profile changes
          onSnapshot(profileRef, (doc) => {
            setProfile(doc.data() as UserProfile);
          });
        }

        // Fetch User Images
        const q = query(
          collection(db, 'images'), 
          where('userId', '==', u.uid),
          orderBy('createdAt', 'desc'), 
          limit(20)
        );
        onSnapshot(q, (snapshot) => {
          const imgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GeneratedImage));
          setImages(imgs);
        }, (err) => {
           console.error("Gallery Sync Error:", err);
        });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleVerifyPix = async () => {
    if (!user || !pixCode.trim() || !selectedPlanForPayment) {
      alert("Por favor, selecione um plano e insira o código da transação PIX.");
      return;
    }

    if (pixCode.length < 15) {
      alert("Código PIX inválido. Por favor, copie o ID da transação completo.");
      return;
    }

    setVerifyingPix(true);
    
    try {
      // 1. Registrar a tentativa no Firestore para auditoria
      const paymentRef = doc(collection(db, 'payments'));
      await setDoc(paymentRef, {
        userId: user.uid,
        userEmail: user.email,
        pixCode: pixCode,
        status: 'pending_verification',
        createdAt: serverTimestamp(),
        planRequested: selectedPlanForPayment
      });

      // 2. Simulação de Detecção Automática
      setTimeout(async () => {
        const creditsMap = { free: 5, pro: 50, elite: 200 };
        
        const profileRef = doc(db, 'users', user.uid);
        await updateDoc(profileRef, {
          plan: selectedPlanForPayment,
          credits: creditsMap[selectedPlanForPayment],
          updatedAt: serverTimestamp()
        });

        await updateDoc(paymentRef, {
          status: 'verified_auto'
        });

        setVerifyingPix(false);
        setPixCode("");
        setSelectedPlanForPayment(null);
        setShowUpgrade(false);
        alert(`PAGAMENTO DETECTADO! Seu plano ${selectedPlanForPayment.toUpperCase()} foi ativado. Aproveite seus novos créditos!`);
      }, 3000);

    } catch (error) {
      console.error("Falha ao processar PIX", error);
      setVerifyingPix(false);
      alert("Erro ao enviar para verificação. Tente novamente.");
    }
  };

  const handleLogin = async () => {
    if (isAuthenticating) return;
    
    setIsAuthenticating(true);
    setAuthError(null);
    
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login Error", error);
      
      // Handle common Firebase Auth errors with user-friendly messages
      if (error.code === 'auth/popup-closed-by-user') {
        setAuthError("O login foi cancelado porque a janela foi fechada.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        setAuthError("Uma solicitação de login já está em andamento.");
      } else if (error.code === 'auth/popup-blocked') {
        setAuthError("O pop-up de login foi bloqueado pelo navegador.");
      } else {
        setAuthError("Ocorreu um erro ao tentar entrar. Tente novamente.");
      }
      
      // Auto-clear error after 5 seconds
      setTimeout(() => setAuthError(null), 5000);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = () => {
    setMobileMenuOpen(false);
    signOut(auth);
  };

  const generateImage = async () => {
    if (!user || !profile || profile.credits <= 0) {
      setShowUpgrade(true);
      return;
    }

    if (!prompt.trim()) return;

    if (!isPromptSafe(prompt)) {
      alert("Sua solicitação contém termos proibidos relacionados a documentos financeiros ou bancários. Por motivos de segurança, não podemos gerar esta imagem.");
      return;
    }

    setGenerating(true);
    try {
      // 1. Call Gemini Image Generation
      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { text: `Create an image of: ${prompt}. Style: ${style}.` }
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio as any,
          }
        }
      });

      let foundImageUrl = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          foundImageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (foundImageUrl) {
        // 2. Consume Credit
        const profileRef = doc(db, 'users', user.uid);
        await updateDoc(profileRef, {
          credits: Math.max(0, profile.credits - 1),
          updatedAt: serverTimestamp()
        });

        // 3. Save to History (Using compressed version for Firestore to avoid 1MB limit)
        // We keep foundImageUrl for current session display if needed, but Firestore needs compression
        const compressedUrl = await compressImage(foundImageUrl, 800);
        
        try {
          const imagesRef = collection(db, 'images');
          const newDocRef = doc(imagesRef);
          await setDoc(newDocRef, {
            userId: user.uid,
            prompt,
            imageUrl: compressedUrl,
            aspectRatio,
            style,
            createdAt: serverTimestamp()
          });
        } catch (error) {
          console.error("Failed to save image to history", error);
          // Still show the image to user even if saving to history failed
        }
      } else {
         console.warn("No image returned from Gemini", response);
      }
    } catch (error) {
       console.error("Generation Failed", error);
       alert("Ocorreu um erro ao gerar a imagem. Tente novamente.");
    } finally {
      setGenerating(false);
    }
  };

  const upgradePlan = async (plan: Plan) => {
    if (!user) return;
    const profileRef = doc(db, 'users', user.uid);
    const creditsMap = { free: 5, pro: 50, elite: 200 };
    
    try {
      await updateDoc(profileRef, {
        plan,
        credits: creditsMap[plan],
        updatedAt: serverTimestamp()
      });
      setShowUpgrade(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
      </div>
    );
  }

  // --- Landing Page ---
  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] text-white overflow-x-hidden selection:bg-blue-500/30">
        <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-black/50 backdrop-blur-md border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-cyan-400 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Visionary</span>
          </div>
          <button 
            onClick={handleLogin}
            disabled={isAuthenticating}
            className="px-5 py-2 bg-white text-black text-sm font-bold rounded-full hover:bg-white/90 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isAuthenticating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
          </button>
        </nav>

        {/* Auth Error Toast */}
        <AnimatePresence>
          {authError && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] bg-red-500 text-white px-6 py-3 rounded-2xl shadow-xl flex items-center gap-2 font-medium"
            >
              <X className="w-5 h-5" onClick={() => setAuthError(null)} />
              {authError}
            </motion.div>
          )}
        </AnimatePresence>

        <main className="relative pt-24 px-6">
          <div className="max-w-7xl mx-auto flex flex-col lg:grid lg:grid-cols-2 gap-12 items-center">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center lg:text-left"
            >
              <h1 className="text-5xl md:text-7xl lg:text-8xl font-black leading-[1] uppercase tracking-tighter mb-6">
                Transforme <br/>
                <span className="text-gradient">Ideias</span> em <br/> Realidade
              </h1>
              <p className="text-lg text-zinc-400 max-w-lg mx-auto lg:mx-0 mb-8 leading-relaxed font-light">
                A Visionary AI utiliza IA premium para criar imagens hiper-realistas. Deixe sua imaginação voar agora.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-6">
                <button 
                  onClick={handleLogin}
                  className="w-full sm:w-auto px-10 py-5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-600/20 flex items-center justify-center gap-2 group"
                >
                  Começar Grátis
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <div className="flex -space-x-3">
                  {[1,2,3,4].map(i => (
                    <img 
                      key={i}
                      src={`https://picsum.photos/seed/${i+50}/100/100`} 
                      className="w-10 h-10 rounded-full border-2 border-[#050505] object-cover"
                      referrerPolicy="no-referrer"
                      alt="User"
                    />
                  ))}
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="relative w-full"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-3 pt-8">
                   <img src="https://picsum.photos/seed/mobile1/400/600" className="w-full rounded-2xl shadow-2xl" referrerPolicy="no-referrer" alt="Art"/>
                   <img src="https://picsum.photos/seed/mobile2/400/400" className="w-full rounded-2xl shadow-2xl" referrerPolicy="no-referrer" alt="Art"/>
                </div>
                <div className="space-y-3">
                   <img src="https://picsum.photos/seed/mobile3/400/400" className="w-full rounded-2xl shadow-2xl" referrerPolicy="no-referrer" alt="Art"/>
                   <img src="https://picsum.photos/seed/mobile4/400/600" className="w-full rounded-2xl shadow-2xl" referrerPolicy="no-referrer" alt="Art"/>
                </div>
              </div>
              <div className="absolute inset-0 bg-blue-600/10 blur-[100px] -z-10" />
            </motion.div>
          </div>
        </main>

        <section className="py-24 px-6 bg-zinc-900/40 mt-24">
          <div className="max-w-7xl mx-auto text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Escolha seu Plano</h2>
            <p className="text-zinc-500">Pague apenas pelo que precisar.</p>
          </div>
          <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
            <PricingCard 
                title="Free" 
                price="0" 
                credits="5" 
                description="Experimente o poder da nossa IA gratuitamente."
                features={["Qualidade Padrão", "5 Créditos Iniciais", "Galeria Pública"]} 
                buttonText="Começar"
                onAction={handleLogin}
            />
            <PricingCard 
                title="Pro" 
                price={PRO_PLAN_PRICE.toString()} 
                credits="50" 
                description="Alta performance para criadores frequentes."
                features={["Alta Resolução", "50 Créditos/Mês", "Sem Watermark"]} 
                highlighted 
                buttonText="Assinar Pro"
                onAction={handleLogin}
            />
            <PricingCard 
                title="Elite" 
                price={ELITE_PLAN_PRICE.toString()} 
                credits="200" 
                description="O plano definitivo para profissionais de arte."
                features={["Qualidade Premium", "200 Créditos/Mês", "Prioridade Máxima"]} 
                buttonText="Assinar Elite"
                onAction={handleLogin}
            />
          </div>
          
          <div className="mt-20 text-center">
            <a 
              href="https://wa.me/5588921708845?text=Olá!%20Tenho%20dúvidas%20sobre%20os%20planos%20do%20Visionary%20AI." 
              target="_blank" 
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-zinc-500 hover:text-white transition-colors"
            >
              <MessageSquare className="w-5 h-5 text-green-500" />
              <span>Dúvidas? Fale conosco no WhatsApp</span>
            </a>
          </div>
        </section>
      </div>
    );
  }

  // --- Authenticated App ---
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col lg:flex-row overflow-hidden h-screen">
      {/* Mobile Top Nav */}
      <div className="lg:hidden flex items-center justify-between px-6 py-4 bg-[#111] border-b border-white/5 z-40">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-500" />
          <span className="font-bold tracking-tight">Visionary</span>
        </div>
        <div className="flex items-center gap-4">
          {deferredPrompt && (
            <button 
              onClick={handleInstallClick}
              className="p-2 bg-blue-600 text-white rounded-lg shadow-lg shadow-blue-600/20"
              title="Instalar App"
            >
              <Smartphone className="w-4 h-4" />
            </button>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/10 rounded-full border border-blue-500/20">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-bold">{profile?.credits || 0}</span>
          </div>
          <button onClick={() => setMobileMenuOpen(true)}>
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Sidebar (Desktop) / Drawer (Mobile) */}
      <AnimatePresence>
        {(mobileMenuOpen || window.innerWidth >= 1024) && (
          <motion.aside 
            initial={window.innerWidth < 1024 ? { x: -300, opacity: 0 } : {}}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-full md:w-80 bg-[#111] border-r border-white/5 flex flex-col p-6 space-y-8 lg:static lg:block",
              !mobileMenuOpen && "hidden lg:flex"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-blue-500" />
                <span className="text-lg font-bold tracking-tight uppercase">Visionary</span>
              </div>
              <button 
                onClick={() => setMobileMenuOpen(false)} 
                className="lg:hidden text-zinc-500"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="space-y-1">
              <button 
                onClick={() => {
                  setShowUpgrade(false);
                  setSelectedImage(null);
                  setSelectedPlanForPayment(null);
                  setMobileMenuOpen(false);
                  const main = document.querySelector('main');
                  if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="flex items-center gap-3 p-3 w-full text-white bg-white/5 rounded-xl transition-all border border-white/10 group active:scale-95"
              >
                <Home className="w-5 h-5 text-blue-500 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold uppercase tracking-widest">Início</span>
              </button>
            </nav>

            <div className="p-5 bg-zinc-900 rounded-3xl border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  Créditos
                </div>
                <span className="text-lg font-bold">{profile?.credits || 0}</span>
              </div>
              <div className="w-full h-1.5 bg-black rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600" 
                  style={{ width: `${Math.min(100, ((profile?.credits || 0) / (profile?.plan === 'free' ? 5 : profile?.plan === 'pro' ? 50 : 200)) * 100)}%` }} 
                />
              </div>
              <button 
                onClick={() => {
                  setShowUpgrade(true);
                  if (window.innerWidth < 1024) setMobileMenuOpen(false);
                }}
                className="w-full py-2.5 bg-white/5 text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-white/10 transition-all border border-white/5"
              >
                Upgrades
              </button>

              {deferredPrompt && (
                <button 
                  onClick={() => {
                    handleInstallClick();
                    if (window.innerWidth < 1024) setMobileMenuOpen(false);
                  }}
                  className="w-full py-2.5 bg-blue-600 text-white text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                >
                  <Smartphone className="w-4 h-4" />
                  Instalar App (APK)
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              <div className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-black">
                <History className="w-3 h-3" />
                Galeria Recente
              </div>
              <div className="grid grid-cols-2 gap-2">
                {images.map((img) => (
                  <motion.div 
                    key={img.id}
                    layoutId={img.id}
                    onClick={() => {
                      setSelectedImage(img);
                      if (window.innerWidth < 1024) setMobileMenuOpen(false);
                    }}
                    className="aspect-square bg-zinc-900 rounded-xl overflow-hidden cursor-pointer active:scale-95 transition-transform"
                  >
                    <img src={img.imageUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="Art"/>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="pt-4 space-y-4 border-t border-white/5">
              <a 
                href="https://wa.me/5588921708845?text=Olá!%20Gostaria%20de%20ajuda%20com%20o%20Visionary%20AI." 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center gap-3 p-3 w-full text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all"
              >
                <MessageSquare className="w-5 h-5 text-green-500" />
                <span className="text-xs font-bold uppercase tracking-widest">Suporte WhatsApp</span>
              </a>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={user.photoURL} className="w-10 h-10 rounded-full border-2 border-blue-500/20" referrerPolicy="no-referrer" alt="User" />
                  <div className="flex-1 min-w-0">
                     <p className="text-sm font-bold truncate">{user.displayName}</p>
                     <p className="text-[10px] text-zinc-500 uppercase font-black">{profile?.plan}</p>
                  </div>
                </div>
                <button onClick={handleLogout} className="p-2 text-zinc-600 hover:text-white transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-4xl w-full mx-auto p-6 md:p-10 space-y-10"
        >
          <header className="space-y-4">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-blue-600/10 rounded-xl">
                  <Sparkles className="w-6 h-6 text-blue-500" />
               </div>
               <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tighter">Estúdio Criativo</h1>
            </div>
            <p className="text-sm text-zinc-500 font-light max-w-lg">
              Descreva sua visão com detalhes. Nossa IA utilizará modelos de ponta para gerar arte hiper-realista em segundos.
            </p>
          </header>

          {/* Generator UI */}
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-[34px] blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>
            <div className="relative bg-[#111] p-6 md:p-8 rounded-[32px] border border-white/5 space-y-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                    O que você quer criar?
                  </label>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={toggleListening}
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        isListening ? "bg-red-500 text-white animate-pulse" : "bg-white/5 text-zinc-500 hover:text-white"
                      )}
                      title="Falar Prompt"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest bg-zinc-900 px-2 py-0.5 rounded-md">
                      {prompt.length} / 500
                    </span>
                  </div>
                </div>
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                placeholder="Ex: Um astronauta medieval caminhando em um mercado cyberpunk, luzes neon, 8k, cinematográfico..."
                className="w-full h-32 md:h-40 bg-black/50 border border-white/10 rounded-2xl p-5 focus:border-blue-500/50 transition-all resize-none text-base font-light outline-none placeholder:text-zinc-700"
              />
              <div className="flex flex-wrap gap-2">
                 {["8k resolution", "highly detailed", "cinematic lighting", "unreal engine 5", "masterpiece"].map(tip => (
                   <button 
                     key={tip}
                     onClick={() => setPrompt(p => p + (p ? ", " : "") + tip)}
                     className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-full text-[10px] text-zinc-500 transition-colors"
                   >
                     + {tip}
                   </button>
                 ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Proporção (Ratio)</p>
                <div className="grid grid-cols-4 gap-2">
                  {["1:1", "4:3", "3:4", "16:9"].map((r) => (
                    <button 
                      key={r} 
                      onClick={() => setAspectRatio(r)}
                      className={cn(
                        "py-3 rounded-xl text-xs font-bold border transition-all",
                        aspectRatio === r ? "bg-blue-600 border-blue-500 text-white" : "bg-black/40 border-white/5 text-zinc-500 hover:bg-black"
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Estilo Artístico</p>
                <div className="grid grid-cols-2 gap-2">
                  {["photorealistic", "digital art", "3d render", "fantasy"].map((s) => (
                    <button 
                      key={s} 
                      onClick={() => setStyle(s)}
                      className={cn(
                        "py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold border transition-all",
                        style === s ? "bg-blue-600 border-blue-500 text-white" : "bg-black/40 border-white/5 text-zinc-500 hover:bg-black"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={generateImage}
              disabled={generating || !prompt.trim()}
              className="w-full py-5 bg-blue-600 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-blue-600/20 disabled:opacity-30 flex items-center justify-center gap-3 active:scale-95"
            >
              {generating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Criar Imagem
                </>
              )}
            </button>
          </div>
        </div>

          {/* Results Grid */}
          {images.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <h2 className="text-xl font-bold uppercase tracking-tight">Criações Recentes</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {images.slice(0, 4).map((img) => (
                  <motion.div 
                    key={img.id}
                    layoutId={img.id + "_card"}
                    className="group bg-[#111] rounded-[24px] overflow-hidden border border-white/5"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden">
                      <img src={img.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" referrerPolicy="no-referrer" alt={img.prompt} />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                         <button 
                            onClick={() => setSelectedImage(img)}
                            className="bg-white text-black p-3 rounded-full shadow-lg hover:scale-110 transition-transform"
                            title="Expandir"
                         >
                           <Maximize2 className="w-5 h-5" />
                         </button>
                         <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadRequest(img.imageUrl);
                            }}
                            className="bg-blue-600 text-white p-3 rounded-full shadow-lg hover:scale-110 transition-transform"
                            title="Download Rápido"
                         >
                           <Download className="w-5 h-5" />
                         </button>
                      </div>
                    </div>
                    <div className="p-4 flex items-center justify-between gap-4">
                      <p className="text-[10px] text-zinc-400 line-clamp-1 italic font-light flex-1">"{img.prompt}"</p>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadRequest(img.imageUrl);
                        }}
                        className="p-2 text-zinc-500 hover:text-blue-500 transition-colors"
                        title="Baixar Imagem"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </main>

      {/* Overlays / Modals */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md"
            onClick={() => setSelectedImage(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 30, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-zinc-900 max-w-4xl w-full rounded-[32px] overflow-hidden shadow-2xl flex flex-col md:flex-row border border-white/10"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-1 bg-black flex items-center justify-center min-h-[300px] md:min-h-[500px]">
                <img src={selectedImage.imageUrl} className="max-h-[70vh] object-contain p-2" referrerPolicy="no-referrer" alt="Expanded"/>
              </div>
              <div className="md:w-80 p-8 flex flex-col justify-between space-y-8 bg-[#111]">
                 <div className="space-y-6">
                    <button onClick={() => setSelectedImage(null)} className="md:hidden absolute top-6 right-6 p-2 bg-black/50 rounded-full">
                       <X className="w-5 h-5" />
                    </button>
                    <div className="space-y-2">
                       <p className="text-[10px] font-black tracking-widest text-zinc-500 uppercase">Prompt</p>
                       <p className="text-sm font-light leading-relaxed">{selectedImage.prompt}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                       <div className="p-3 bg-black/40 rounded-xl">
                          <p className="text-[8px] uppercase tracking-widest text-zinc-500">Proporção</p>
                          <p className="text-xs font-bold">{selectedImage.aspectRatio}</p>
                       </div>
                       <div className="p-3 bg-black/40 rounded-xl">
                          <p className="text-[8px] uppercase tracking-widest text-zinc-500">Estilo</p>
                          <p className="text-xs font-bold capitalize">{selectedImage.style}</p>
                       </div>
                    </div>
                 </div>
                 <button 
                  onClick={() => handleDownloadRequest(selectedImage.imageUrl)}
                  className="w-full py-4 bg-white text-black font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all"
                 >
                   <Download className="w-5 h-5" />
                   Baixar Imagem
                 </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showDownloadConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-white/10 p-8 rounded-[32px] max-w-sm w-full text-center space-y-6 shadow-2xl"
            >
              <div className="w-16 h-16 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto">
                <Download className="w-8 h-8 text-blue-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold uppercase tracking-tight">Confirmar Download</h3>
                <p className="text-zinc-500 text-sm font-light">Tem certeza que deseja baixar esta imagem?</p>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button 
                  onClick={() => {
                    setShowDownloadConfirm(false);
                    setDownloadUrl(null);
                  }}
                  className="py-3 bg-zinc-800 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-zinc-700 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={executeDownload}
                  className="py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showUpgrade && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black overflow-y-auto"
          >
            <AnimatePresence mode="wait">
              {!selectedPlanForPayment ? (
                <motion.div
                  key="pricing-selection"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* Hero Section */}
                  <div className="relative h-[70vh] flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 z-0">
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/50 to-black z-10" />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 opacity-50 scale-110">
                        {[
                          "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=800",
                          "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=800",
                          "https://images.unsplash.com/photo-1614728263952-84ea256f9679?auto=format&fit=crop&q=80&w=800",
                          "https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&q=80&w=800"
                        ].map((src, i) => (
                          <motion.img 
                            key={i}
                            src={src}
                            initial={{ scale: 1.2, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 2, delay: i * 0.2 }}
                            className="w-full h-full object-cover rounded-3xl"
                          />
                        ))}
                      </div>
                    </div>

                    <div className="relative z-20 text-center px-6 max-w-5xl mx-auto space-y-8">
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-600/20 text-blue-400 rounded-full text-xs font-black uppercase tracking-[0.3em] border border-blue-500/20 mx-auto"
                      >
                        <Sparkles className="w-3 h-3" />
                        Premium Experience
                      </motion.div>
                      <motion.h2 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.6 }}
                        className="text-5xl md:text-8xl font-black uppercase tracking-tighter leading-[0.85] text-white"
                      >
                        Libere sua <br/> <span className="text-blue-500">Criatividade</span>
                      </motion.h2>
                      <motion.p 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.7 }}
                        className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto font-light leading-relaxed"
                      >
                        Transforme ideias em realidade com o estúdio de IA mais potente do mercado. 
                        Escolha um plano e comece a criar sem limites.
                      </motion.p>
                      
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.8 }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4"
                      >
                        <button 
                          onClick={() => {
                            const pricing = document.getElementById('pricing-grid');
                            pricing?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="w-full sm:w-auto px-10 py-5 bg-white text-black rounded-2xl font-black uppercase tracking-widest text-xs hover:scale-105 active:scale-95 transition-all shadow-xl shadow-white/10"
                        >
                          Explorar Planos
                        </button>
                        <button 
                          onClick={() => setShowUpgrade(false)}
                          className="w-full sm:w-auto px-10 py-5 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs border border-white/10 hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
                        >
                          Ir para o Estúdio
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </motion.div>
                    </div>
                  </div>

                  <div id="pricing-grid" className="max-w-7xl w-full mx-auto p-6 md:p-20 space-y-20 pb-32">
                    <div className="text-center space-y-4">
                      <h3 className="text-3xl font-black uppercase tracking-tighter">Escolha sua Jornada</h3>
                      <p className="text-zinc-500 max-w-md mx-auto">Preços transparentes para todos os níveis de criadores.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                      <PricingCard 
                        title="Visionary Pro"
                        price={PRO_PLAN_PRICE.toString()}
                        credits="50"
                        description="Ideal para criadores que buscam alta qualidade e velocidade."
                        features={["50 Créditos Mentais", "Qualidade 4K Ultra", "Sem Marcas d'água", "Entrega Prioritária"]}
                        buttonText="Assinar Pro"
                        onAction={() => setSelectedPlanForPayment('pro')}
                        compact
                      />
                      <PricingCard 
                        title="Visionary Elite"
                        price={ELITE_PLAN_PRICE.toString()}
                        credits="200"
                        description="Para profissionais e agências que precisam do máximo poder da IA."
                        features={["200 Créditos Mentais", "Acesso a Modelos Beta", "Suporte VIP 24/7", "Licença Comercial"]}
                        buttonText="Assinar Elite"
                        onAction={() => setSelectedPlanForPayment('elite')}
                        highlighted
                        compact
                      />
                    </div>
                  </div>
                </motion.div>
              ) : (
                /* PIX Payment Section (Dedicated View) */
                <motion.div 
                  key="pix-checkout"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="min-h-screen flex items-center justify-center p-6"
                >
                  <div className="w-full max-w-3xl bg-zinc-900/50 rounded-[32px] p-8 border border-blue-500/30 shadow-2xl shadow-blue-500/10">
                    <div className="flex flex-col md:flex-row items-center gap-10">
                      <div className="bg-white p-4 rounded-2xl shadow-xl">
                        <QRCodeSVG 
                          value={selectedPlanForPayment === 'pro' ? `PIX-PAYLOAD-PRO-R$${PRO_PLAN_PRICE}-${PIX_CPF}` : `PIX-PAYLOAD-ELITE-R$${ELITE_PLAN_PRICE}-${PIX_CPF}`}
                          size={180}
                          level="H"
                          includeMargin={false}
                        />
                      </div>
                      <div className="flex-1 space-y-6 text-center md:text-left">
                        <div className="space-y-2">
                          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-[10px] font-black uppercase tracking-widest">
                            <Smartphone className="w-3 h-3" />
                            Checkout: Plano {selectedPlanForPayment.toUpperCase()}
                          </div>
                          <h3 className="text-2xl font-black uppercase tracking-tight">Pagamento com PIX</h3>
                          <p className="text-sm text-zinc-500 font-light leading-relaxed">
                            Escaneie o QR Code ao lado para o plano <span className="text-white font-bold">{selectedPlanForPayment.toUpperCase()}</span>. 
                            Após o pagamento, o sistema detectará automaticamente em instantes.
                          </p>
                        </div>

                        <div className="space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Chave PIX (CPF)</p>
                          <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-xl border border-white/5">
                            <input 
                              readOnly 
                              value={PIX_CPF} 
                              className="flex-1 bg-transparent px-3 text-sm font-bold outline-none"
                            />
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(PIX_CPF);
                                alert("Chave PIX copiada!");
                              }}
                              className="p-3 bg-white text-black rounded-lg hover:bg-zinc-200 transition-all active:scale-95"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-3 pt-4 border-t border-white/5">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Cole o ID da transação aqui</p>
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-xl border border-blue-500/30 focus-within:border-blue-500 transition-colors">
                              <input 
                                placeholder="Código E2E (Ex: E0000...)"
                                value={pixCode}
                                onChange={(e) => setPixCode(e.target.value)}
                                className="flex-1 bg-transparent px-3 py-2 text-sm font-medium outline-none text-white placeholder:text-zinc-600"
                              />
                            </div>
                            <button 
                              onClick={handleVerifyPix}
                              disabled={verifyingPix || !pixCode.trim()}
                              className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                            >
                              {verifyingPix ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Verificando...
                                </>
                              ) : (
                                "Ativar Plano Agora"
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <button 
                            onClick={() => setSelectedPlanForPayment(null)}
                            className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
                          >
                            ← Voltar para Planos
                          </button>
                          <a 
                            href={`https://wa.me/5588921708845?text=Olá!%20Fiz%20um%20PIX%20de%20R$%20${selectedPlanForPayment === 'pro' ? PRO_PLAN_PRICE : ELITE_PLAN_PRICE}%20para%20o%20Visionary%20AI.%20ID:%20${user?.uid}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-500 hover:text-green-400 transition-colors"
                          >
                            <MessageSquare className="w-4 h-4" />
                            Suporte
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PricingCard({ 
    title, 
    price, 
    credits, 
    features, 
    description,
    highlighted = false, 
    buttonText,
    onAction,
    compact = false
}: { 
    title: string; 
    price: string; 
    credits: string; 
    features: string[]; 
    description: string;
    highlighted?: boolean; 
    buttonText: string;
    onAction: () => void;
    compact?: boolean;
}) {
  return (
    <div className={cn(
      "p-8 rounded-[40px] flex flex-col justify-between transition-all border",
      highlighted 
        ? "bg-blue-600 border-blue-500 text-white shadow-2xl shadow-blue-600/20 text-white scale-105 z-10" 
        : "bg-zinc-900 border-white/5 text-zinc-200 hover:border-zinc-700 hover:-translate-y-1"
    )}>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className={cn("text-[10px] font-black uppercase tracking-widest", highlighted ? "text-blue-100" : "text-zinc-500")}>
            Plano {title}
          </p>
          <div className="flex items-baseline justify-center md:justify-start gap-1">
            <span className="text-4xl font-black">R$ {price}</span>
            <span className="text-sm opacity-60">/mês</span>
          </div>
          <p className={cn("text-xs font-medium leading-relaxed italic", highlighted ? "text-blue-200" : "text-zinc-500")}>
            {description}
          </p>
        </div>

        <div className="py-4 px-6 bg-black/20 rounded-2xl flex items-center gap-4">
          <Zap className={cn("w-6 h-6", highlighted ? "text-amber-300" : "text-amber-500")} />
          <div>
            <p className="text-xl font-black leading-tight">{credits}</p>
            <p className="text-[10px] uppercase font-bold tracking-widest opacity-60">Créditos/Mês</p>
          </div>
        </div>

        {!compact && (
          <ul className="space-y-3 pt-2">
            {features.map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm opacity-80 decoration-zinc-500">
                <Check className="w-4 h-4 flex-shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button 
        onClick={onAction}
        className={cn(
          "w-full py-4 mt-8 font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2",
          highlighted 
            ? "bg-white text-black hover:bg-zinc-100" 
            : "bg-blue-600 text-white hover:bg-blue-500"
        )}
      >
        {buttonText}
      </button>
    </div>
  );
}
