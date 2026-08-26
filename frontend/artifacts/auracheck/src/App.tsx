import { createContext, type ChangeEvent, type MouseEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Form } from '@/components/ui/form';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  Download,
  FileText,
  Github,
  Headphones,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Mic,
  Play,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UsersRound,
  Volume2,
  X,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import {
  ApiError,
  getGetCurrentUserQueryKey,
  getGetInterviewQueryKey,
  getHealthCheckQueryKey,
  getGetGithubFootprintQueryKey,
  getInterview,
  getListInterviewsQueryKey,
  useDeleteInterview,
  useEndSession,
  useGetCurrentUser,
  useGetGithubFootprint,
  useGetInterview,
  useHealthCheck,
  useListInterviews,
  useLogin,
  useLogout,
  useSignup,
  useStartSession,
  useUploadResume,
} from '@workspace/api-client-react';
import type { AuthUser, InterviewSummary } from '@workspace/api-client-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const logoPath = '/assets/auracheck-logo.jpg';

type Agent = { name: string; role: string; color: string; status: string };
type Session = { sessionId: string; status: string; openingPrompt: string; agents: Agent[] };
type ScoreDimension = { label: string; note: string; score: number | null };
type Scorecard = {
  sessionId: string;
  interviewId?: string;
  overallAssessment: string;
  dimensions: ScoreDimension[];
  redFlags: string[];
  mandatoryRepairSteps: string[];
  parseWarning: boolean;
  overallScore: number | null;
  strengths: string[];
  weaknesses: string[];
  areasToImprove: string[];
  finalRecommendation: string | null;
};
type SetupValues = { candidateName: string; targetRole: string; githubUsername: string; resumeName: string };

// Matches backend/crew/interview_conductor.py's INTERVIEWERS roster.
const demoAgents: Agent[] = [
  { name: 'Sarah', role: 'HR', color: '#f59e0b', status: 'ready' },
  { name: 'Alex', role: 'Technical', color: '#8b5cf6', status: 'ready' },
  { name: 'Dave', role: 'Projects', color: '#2dd4bf', status: 'ready' },
];

const demoSession: Session = {
  sessionId: 'demo-aura-session',
  status: 'ready',
  openingPrompt: 'Welcome, Arjun. Let’s start with the work you’re most proud of — what made it matter?',
  agents: demoAgents,
};

function saveSession(session: Session) {
  sessionStorage.setItem('auracheck-session', JSON.stringify(session));
}
function getSession(): Session {
  try {
    return JSON.parse(sessionStorage.getItem('auracheck-session') || 'null') || demoSession;
  } catch {
    return demoSession;
  }
}
function Logo({ compact = false, theme = 'dark' }: { compact?: boolean; theme?: 'dark' | 'light' }) {
  const auraColor = theme === 'dark' ? 'text-[#f8f4ed]' : 'text-[#2b2a3b]';
  const checkColor = theme === 'dark' ? 'text-[#9ccfc0]' : 'text-[#397767]';
  const taglineColor = theme === 'dark' ? 'text-[#9da0b1]' : 'text-[#8e888d]';
  return (
    <div className="flex items-center gap-3" data-testid="brand-auracheck">
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-[#8f70ae]/60 bg-[#eee6f5]">
        <img
          src={logoPath}
          alt="AuraCheck logo mark"
          className="absolute h-auto w-[147px] max-w-none"
          style={{ left: '-56px', top: '-10px' }}
        />
      </div>
      {!compact && <div><div className={`font-display text-[23px] leading-none tracking-[-.04em] ${auraColor}`}>aura<span className={checkColor}>Check</span></div><div className={`mt-1 text-[8px] uppercase tracking-[.23em] ${taglineColor}`}>from vibe to verified</div></div>}
    </div>
  );
}

const AuthContext = createContext<{ user: AuthUser | null; isLoading: boolean } | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  return <AuthContext.Provider value={{ user: me.data ?? null, isLoading: me.isLoading }}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
}

function formatHeaderDate(date: Date): string {
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const day = date.toLocaleDateString(undefined, { day: '2-digit' });
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  return `${weekday}, ${day} ${month} ${date.getFullYear()}`;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#f5f1e9]"><LoaderCircle size={22} className="animate-spin text-[#8d67ae]" /></div>;
  }
  if (!user) {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f5f1e9] px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex justify-center"><Logo theme="light" /></div>
        <div className="rounded-[25px] border border-[#e4ddd3] bg-[#fbf8f2] p-8 shadow-[0_16px_45px_rgba(44,40,56,.06)]">{children}</div>
      </div>
    </div>
  );
}

type SignupValues = { name: string; email: string; password: string };

function SignupPage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const signup = useSignup();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignupValues>({ defaultValues: { name: '', email: '', password: '' } });

  if (!isLoading && user) return <Redirect to="/" />;

  const onSubmit = async (values: SignupValues) => {
    setError(null);
    try {
      const created = await signup.mutateAsync({ data: values });
      queryClient.setQueryData(getGetCurrentUserQueryKey(), created);
      setLocation('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach AuraCheck. Please try again.');
    }
  };

  return (
    <AuthLayout>
      <SectionLabel>Create your account</SectionLabel>
      <h1 className="font-display text-[32px] leading-tight tracking-[-.03em] text-[#262536]">Bring your whole signal.</h1>
      <p className="mt-2 text-[13px] leading-6 text-[#77727d]">Set up your account to start practicing.</p>
      <Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <label className="block"><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Name</span><input {...form.register('name', { required: true })} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] px-4 py-3.5 text-[13px] outline-none transition-colors focus:border-[#8d67ae] focus:ring-2 focus:ring-[#8d67ae]/10" data-testid="input-signup-name" /></label>
        <label className="block"><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Email</span><div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#958c99]" /><input type="email" {...form.register('email', { required: true })} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] py-3.5 pl-11 pr-4 text-[13px] outline-none transition-colors focus:border-[#8d67ae] focus:ring-2 focus:ring-[#8d67ae]/10" data-testid="input-signup-email" /></div></label>
        <label className="block"><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Password</span><div className="relative"><LockKeyhole size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#958c99]" /><input type="password" {...form.register('password', { required: true, minLength: 8 })} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] py-3.5 pl-11 pr-4 text-[13px] outline-none transition-colors focus:border-[#8d67ae] focus:ring-2 focus:ring-[#8d67ae]/10" data-testid="input-signup-password" /></div><span className="mt-1.5 block text-[10px] text-[#94849d]">At least 8 characters.</span></label>
        <button type="submit" disabled={signup.isPending} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#2d4540] px-5 py-3.5 text-[12px] font-semibold text-[#f2f7f3] transition-all hover:-translate-y-0.5 hover:bg-[#426b5d] disabled:cursor-wait disabled:opacity-70" data-testid="button-signup-submit">{signup.isPending ? <LoaderCircle size={16} className="animate-spin" /> : null} Create account</button>
        {error && <p className="text-center text-[11px] leading-5 text-[#a35a5a]" data-testid="text-signup-error">{error}</p>}
      </form></Form>
      <p className="mt-6 text-center text-[12px] text-[#8e888d]">Already have an account? <Link href="/login" className="font-semibold text-[#8d67ae] hover:underline" data-testid="link-go-login">Sign in</Link></p>
    </AuthLayout>
  );
}

type LoginValues = { email: string; password: string };

function LoginPage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const login = useLogin();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginValues>({ defaultValues: { email: '', password: '' } });

  if (!isLoading && user) return <Redirect to="/" />;

  const onSubmit = async (values: LoginValues) => {
    setError(null);
    try {
      const signedIn = await login.mutateAsync({ data: values });
      queryClient.setQueryData(getGetCurrentUserQueryKey(), signedIn);
      setLocation('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach AuraCheck. Please try again.');
    }
  };

  return (
    <AuthLayout>
      <SectionLabel>Welcome back</SectionLabel>
      <h1 className="font-display text-[32px] leading-tight tracking-[-.03em] text-[#262536]">Good to see you again.</h1>
      <p className="mt-2 text-[13px] leading-6 text-[#77727d]">Sign in to get back in the room.</p>
      <Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <label className="block"><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Email</span><div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#958c99]" /><input type="email" {...form.register('email', { required: true })} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] py-3.5 pl-11 pr-4 text-[13px] outline-none transition-colors focus:border-[#8d67ae] focus:ring-2 focus:ring-[#8d67ae]/10" data-testid="input-login-email" /></div></label>
        <label className="block"><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Password</span><div className="relative"><LockKeyhole size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#958c99]" /><input type="password" {...form.register('password', { required: true })} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] py-3.5 pl-11 pr-4 text-[13px] outline-none transition-colors focus:border-[#8d67ae] focus:ring-2 focus:ring-[#8d67ae]/10" data-testid="input-login-password" /></div></label>
        <button type="submit" disabled={login.isPending} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#2d4540] px-5 py-3.5 text-[12px] font-semibold text-[#f2f7f3] transition-all hover:-translate-y-0.5 hover:bg-[#426b5d] disabled:cursor-wait disabled:opacity-70" data-testid="button-login-submit">{login.isPending ? <LoaderCircle size={16} className="animate-spin" /> : null} Sign in</button>
        {error && <p className="text-center text-[11px] leading-5 text-[#a35a5a]" data-testid="text-login-error">{error}</p>}
      </form></Form>
      <p className="mt-6 text-center text-[12px] text-[#8e888d]">New to AuraCheck? <Link href="/signup" className="font-semibold text-[#8d67ae] hover:underline" data-testid="link-go-signup">Create an account</Link></p>
    </AuthLayout>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const signOut = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
        sessionStorage.removeItem('auracheck-session');
        sessionStorage.removeItem('auracheck-scorecard');
        setMobileOpen(false);
        setLocation('/login');
      },
    });
  };
  const displayName = user?.name || 'Candidate';
  const items = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/setup', label: 'Prepare a session', icon: Plus },
    { href: '/scorecard', label: 'Scorecards', icon: BarChart3 },
    { href: '/settings', label: 'Settings', icon: SettingsIcon },
  ];
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#f5f1e9] text-[#272638]">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[238px] flex-col border-r border-[#37374a] bg-[#202031] px-5 py-6 transition-transform duration-300 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-12 flex items-center justify-between px-1">
          <Logo />
          <button className="rounded-lg p-1 text-[#9da0b1] hover:bg-[#333348] md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-menu"><X size={17} /></button>
        </div>
        <div className="mb-3 px-2 font-mono-ui text-[9px] uppercase tracking-[.18em] text-[#777b92]">Your room</div>
        <nav className="space-y-1">
          {items.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href} onClick={() => setMobileOpen(false)} data-testid={`link-${label.toLowerCase().replaceAll(' ', '-')}`} className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium transition-all ${location === href ? 'bg-[#8d67ae] text-[#fffaf3] shadow-[0_8px_20px_rgba(141,103,174,.25)]' : 'text-[#a7a8b9] hover:bg-[#303044] hover:text-[#fbf8f2]'}`}>
              <Icon size={17} strokeWidth={location === href ? 2.4 : 1.7} /><span>{label}</span>{location === href && <ChevronRight className="ml-auto" size={14} />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-5 rounded-2xl border border-[#3c3b50] bg-[#29293c] p-4">
            <div className="mb-3 flex items-center gap-2 text-[#b8a3ce]"><ShieldCheck size={15} /><span className="font-mono-ui text-[9px] uppercase tracking-[.15em]">Private by design</span></div>
            <p className="text-[11px] leading-[1.5] text-[#9799aa]">Your evidence stays yours. AuraCheck only uses it to make your coaching more honest.</p>
          </div>
          <button onClick={signOut} disabled={logout.isPending} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[12px] text-[#8e91a4] transition-colors hover:bg-[#303044] hover:text-[#f5f1e9] disabled:opacity-60" data-testid="button-log-out">{logout.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <LogOut size={16} />} Sign out</button>
          <div className="mt-3 flex items-center gap-3 border-t border-[#39394c] px-2 pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#93c8b9] font-mono-ui text-[11px] text-[#233c39]">{initials(displayName)}</div>
            <div><div className="text-[12px] font-semibold text-[#ece8e0]">{displayName}</div><div className="text-[10px] text-[#898b9d]">Candidate profile</div></div>
          </div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-[#1d1e2a]/60 md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-dismiss-menu" />}
      <div className="min-w-0 md:pl-[238px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[#e5dfd5] bg-[#f5f1e9]/90 px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3"><button className="rounded-lg p-2 text-[#5d5b6b] hover:bg-[#ebe5dc] md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={19} /></button><span className="hidden font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#99949b] sm:inline">{formatHeaderDate(new Date())}</span></div>
          <div className="flex items-center gap-2 sm:gap-4"><button className="relative rounded-xl p-2 text-[#77717d] transition-colors hover:bg-[#ebe5dc]" data-testid="button-notifications"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#a374ba]" /></button><div className="hidden h-5 w-px bg-[#dfd8ce] sm:block" /><Link href="/settings" className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-[#ebe5dc]" data-testid="link-header-profile"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d5e9df] font-mono-ui text-[10px] font-medium text-[#326153]">{initials(displayName)}</div><span className="hidden text-[12px] font-semibold text-[#444252] sm:inline">{displayName}</span></Link></div>
        </header>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.19em] text-[#99929a]"><span className="h-1.5 w-1.5 rounded-full bg-[#a378bc]" />{children}</div>;
}

const PANEL_ROSTER = [
  { name: 'Alex', role: 'GitHub & evidence check', color: '#8b5cf6' },
  { name: 'Dave', role: 'Technical depth', color: '#2dd4bf' },
  { name: 'Sarah', role: 'Clarity & English', color: '#f59e0b' },
  { name: 'Marcus', role: 'Domain fit', color: '#fb7185' },
  { name: 'Judge', role: 'Final assessment', color: '#60a5fa' },
];

function Home() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  return (
    <div className="page-enter mx-auto max-w-[1340px] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div><div className="mb-4 flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#8d67ae]"><span className="pulse-dot h-2 w-2 rounded-full bg-[#8d67ae]" /> {health.isLoading ? 'Checking your room' : health.isError ? 'Demo room · ready to explore' : 'Your room is ready'}</div><h1 className="font-display text-[clamp(40px,5vw,68px)] leading-[.93] tracking-[-.04em] text-[#262536]">Make your next<br /><em className="text-[#8d67ae]">yes</em> feel earned.</h1><p className="mt-5 max-w-[470px] text-[15px] leading-7 text-[#73707b]">A little practice, a little proof, and a clearer version of you in the room.</p></div>
        <Link href="/setup" className="group inline-flex w-fit items-center gap-3 rounded-full bg-[#2b2a3b] px-5 py-3.5 text-[12px] font-semibold text-[#faf6ee] transition-all hover:-translate-y-0.5 hover:bg-[#8d67ae] hover:shadow-lg hover:shadow-[#8d67ae]/20" data-testid="link-start-practice"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#9ccfc0] text-[#203331]"><Plus size={14} /></span> Start a practice room <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></Link>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_.9fr]">
        <div className="relative overflow-hidden rounded-[26px] bg-[#2a293a] p-6 text-[#f7f2ea] shadow-[0_16px_45px_rgba(44,40,56,.12)] sm:p-8">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border border-[#9e7cbd]/30" /><div className="absolute -right-5 -top-9 h-44 w-44 rounded-full border border-[#9e7cbd]/20" />
          <div className="relative z-10"><SectionLabel>How it works</SectionLabel><h2 className="font-display text-[32px] tracking-[-.02em]">Five specialists listen while you talk.</h2><p className="mt-3 max-w-[420px] text-[13px] leading-6 text-[#c8c3d6]">Each one checks something different against your resume and public GitHub work, live, as you speak.</p></div>
          <div className="relative z-10 mt-8 grid grid-cols-2 gap-3 border-t border-[#444356] pt-6 sm:grid-cols-3">{PANEL_ROSTER.map((agent) => <div key={agent.name} className="rounded-xl border border-[#43415a] bg-[#33324a] p-3"><div className="mb-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold" style={{ backgroundColor: `${agent.color}2a`, color: agent.color }}>{agent.name[0]}</div><div className="text-[12px] font-semibold text-[#f0ecf5]">{agent.name}</div><div className="mt-0.5 text-[10px] text-[#a5a2b2]">{agent.role}</div></div>)}</div>
        </div>
        <div className="rounded-[26px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><SectionLabel>Next best move</SectionLabel><div className="mt-6 flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe2f6] text-[#8d67ae]"><Headphones size={20} /></div><div><h2 className="font-display text-[26px] leading-tight text-[#343243]">Rehearse your opening.</h2><p className="mt-2 text-[13px] leading-6 text-[#77727d]">Start a room and lead with the outcome before the process — it's the easiest thing to sharpen first.</p></div></div><Link href="/setup" className="mt-8 flex items-center justify-between border-t border-[#e7e0d7] pt-4 text-[12px] font-semibold text-[#8d67ae] transition-colors hover:text-[#68478a]" data-testid="link-rehearse-opening">Open a focused room <ArrowRight size={15} /></Link></div>
      </div>
    </div>
  );
}

function Setup() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const startSession = useStartSession();
  const uploadResume = useUploadResume();
  const [resumeName, setResumeName] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeStatus, setResumeStatus] = useState<'idle' | 'selected' | 'uploading' | 'done' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<SetupValues>({ defaultValues: { candidateName: user?.name || '', targetRole: 'Frontend Engineer', githubUsername: '', resumeName: '' } });
  const watchedGithub = form.watch('githubUsername');
  const [debouncedGithub, setDebouncedGithub] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedGithub(watchedGithub.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [watchedGithub]);
  const githubQuery = useGetGithubFootprint(debouncedGithub || 'auracheck-demo', { query: { enabled: Boolean(debouncedGithub), queryKey: getGetGithubFootprintQueryKey(debouncedGithub || 'auracheck-demo') } });
  const github = githubQuery.data;
  const onSubmit = async (values: SetupValues) => {
    setSubmitError(null);
    const payload = { ...values, githubUsername: values.githubUsername || null, resumeName: values.resumeName || resumeName || null };
    try {
      const session = (await startSession.mutateAsync({ data: payload })) as Session;

      if (resumeFile) {
        setResumeStatus('uploading');
        try {
          await uploadResume.mutateAsync({ data: { sessionId: session.sessionId, file: resumeFile } });
          setResumeStatus('done');
        } catch {
          setResumeStatus('error');
        }
      }

      saveSession(session);
      setLocation('/interview');
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not reach the interview engine. Please try again.');
    }
  };
  const onResume = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setResumeName(file.name); form.setValue('resumeName', file.name); setResumeFile(file); setResumeStatus('selected');
  };
  return (
    <div className="page-enter mx-auto max-w-[1080px] px-5 py-8 sm:px-8 sm:py-12"><div className="mb-10 max-w-[640px]"><SectionLabel>New practice room</SectionLabel><h1 className="font-display text-[clamp(42px,6vw,70px)] leading-[.95] tracking-[-.045em]">Bring your whole<br /><em className="text-[#8d67ae]">signal</em> into the room.</h1><p className="mt-5 max-w-[510px] text-[14px] leading-7 text-[#77727d]">Give the panel enough context to ask better questions. Nothing here needs to be perfect — it just needs to be yours.</p></div>
      <Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
        <div className="rounded-[25px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><div className="mb-7 flex items-center justify-between"><div><h2 className="font-display text-[29px]">Set the context</h2><p className="mt-1 text-[12px] text-[#8e888d]">A calm start makes for a sharper conversation.</p></div><span className="font-mono-ui text-[10px] text-[#aaa2a5]">01 / 02</span></div><div className="space-y-5"><label className="block"><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Your name</span><input {...form.register('candidateName', { required: true })} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] px-4 py-3.5 text-[13px] outline-none transition-colors focus:border-[#8d67ae] focus:ring-2 focus:ring-[#8d67ae]/10" data-testid="input-candidate-name" /></label><label className="block"><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Target role</span><div className="relative"><SlidersHorizontal size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#958c99]" /><input {...form.register('targetRole', { required: true })} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] py-3.5 pl-11 pr-4 text-[13px] outline-none transition-colors focus:border-[#8d67ae] focus:ring-2 focus:ring-[#8d67ae]/10" data-testid="input-target-role" /></div></label><div><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Resume <span className="font-normal text-[#aaa2a5]">(optional, but useful)</span></span><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#cfc5d4] bg-[#f4edf8] px-4 py-4 transition-colors hover:border-[#8d67ae] hover:bg-[#efe5f5]" data-testid="label-resume-upload"><input type="file" accept=".pdf,.doc,.docx" onChange={onResume} className="sr-only" data-testid="input-resume" /><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#dfcaec] text-[#80569e]">{resumeStatus === 'uploading' ? <LoaderCircle size={17} className="animate-spin" /> : resumeStatus === 'done' ? <Check size={17} /> : resumeStatus === 'error' ? <X size={17} /> : <Upload size={17} />}</div><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold text-[#5c4d68]">{resumeName || 'Drop your latest resume here'}</div><div className="mt-1 text-[10px] text-[#94849d]">{resumeStatus === 'error' ? "Couldn't attach — you can still continue without it" : resumeName ? 'Resume attached for this room' : 'PDF, DOC or DOCX · up to 10 MB'}</div></div><FileText size={17} className="text-[#b59cc4]" /></label></div></div></div>
        <div className="flex flex-col rounded-[25px] border border-[#e4ddd3] bg-[#e9f3ed] p-6 sm:p-8"><div className="flex items-center justify-between"><div><h2 className="font-display text-[29px]">Find your proof</h2><p className="mt-1 text-[12px] text-[#6f8278]">Connect the work behind your words.</p></div><span className="font-mono-ui text-[10px] text-[#9aada2]">02 / 02</span></div><div className="mt-7"><label className="mb-2 block text-[11px] font-semibold text-[#526c61]">GitHub username</label><div className="relative"><Github size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5c8d7e]" /><input {...form.register('githubUsername')} placeholder="e.g. arjunbuilds" className="w-full rounded-xl border border-[#c9ddd2] bg-[#f3f9f5] py-3.5 pl-11 pr-4 text-[13px] outline-none transition-colors placeholder:text-[#a4b7ad] focus:border-[#5c9a87] focus:ring-2 focus:ring-[#5c9a87]/10" data-testid="input-github-username" /></div></div>{githubQuery.isFetching && <div className="mt-4 flex items-center gap-2 text-[11px] text-[#688277]"><LoaderCircle size={13} className="animate-spin" /> Reading your public footprint…</div>}{github && !githubQuery.isFetching && <div className="mt-4 rounded-xl border border-[#cbded4] bg-[#f3f9f5] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[12px] font-semibold text-[#426b5d]"><Check size={15} /> @{github.username}</div><span className="font-mono-ui text-[10px] text-[#78958a]">{github.repositories} repos</span></div><p className="mt-2 text-[11px] leading-5 text-[#71887e]">{github.summary}</p></div>}{!github && <div className="mt-4 rounded-xl border border-[#cbded4] bg-[#dfeee6] p-4 text-[11px] leading-5 text-[#70897e]"><LockKeyhole size={15} className="mb-2 text-[#5d917f]" /><span>Your repositories stay public-only. We look for patterns, not perfection.</span></div>}<div className="mt-auto pt-8"><div className="mb-5 flex flex-wrap gap-2">{['Clarity', 'Technical depth', 'Story', 'Evidence'].map((tag) => <span key={tag} className="rounded-full border border-[#c8dbd0] bg-[#f3f9f5] px-3 py-1.5 text-[10px] text-[#658176]">{tag}</span>)}</div><button type="submit" disabled={startSession.isPending} className="group flex w-full items-center justify-center gap-3 rounded-full bg-[#2d4540] px-5 py-4 text-[12px] font-semibold text-[#f2f7f3] transition-all hover:-translate-y-0.5 hover:bg-[#426b5d] disabled:cursor-wait disabled:opacity-70" data-testid="button-start-session">{startSession.isPending ? <><LoaderCircle size={16} className="animate-spin" /> Setting the room…</> : <><Play size={15} fill="currentColor" /> Start my practice room <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></>}</button><div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-[#8aa096]"><ShieldCheck size={12} /> Five specialist agents · one honest read</div></div></div>
      </form></Form>{submitError && <div className="fixed bottom-5 right-5 z-30 flex items-center gap-3 rounded-xl border border-[#e8b4b4] bg-[#fbf1f1] px-4 py-3 text-[12px] text-[#8a4a4a] shadow-xl" data-testid="status-submit-error"><X size={15} /> {submitError}</div>}</div>
  );
}

function AgentPill({ agent, active = false }: { agent: Agent; active?: boolean }) {
  const isBackground = agent.status === 'background';
  return <div className={`flex items-center gap-2.5 rounded-full border px-2.5 py-1.5 transition-all ${active ? 'border-[#9d7db8] bg-[#eee4f5]' : isBackground ? 'border-dashed border-[#e3dfe5] bg-[#f8f5f8] opacity-70' : 'border-[#e3dfe5] bg-[#f8f5f8]'}`} data-testid={`agent-${agent.name.toLowerCase()}`} title={isBackground ? `${agent.name} checks evidence in the background -- doesn't ask questions live` : undefined}><div className="relative flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold" style={{ backgroundColor: `${agent.color}2a`, color: agent.color }}>{agent.name[0]}{!isBackground && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-[#f8f5f8] bg-[#7db397]" />}</div><div className="hidden text-[10px] font-semibold text-[#5e5965] sm:block">{agent.name}{isBackground && <span className="ml-1 font-normal text-[#a39fa8]">(background)</span>}</div></div>;
}

type AgentFinding = { id: string; agent: string; finding: string; severity: string; reasoning: string };

// Minimal shape of the non-standard SpeechRecognition API this component
// uses. Not in TS's DOM lib (still vendor-prefixed/experimental), so it's
// declared locally rather than pulled in as `any` everywhere.
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => SpeechRecognitionLike) | null;
}

const FEMALE_VOICE_HINTS = /female|zira|samantha|victoria|susan|karen|linda|hazel|fiona|aria/i;
const MALE_VOICE_HINTS = /male|david|mark|daniel|james|george|fred|guy|ryan/i;

// Sarah/Alex/Dave each need a genuinely different voice, consistent across
// the session -- built once from whatever the browser/OS actually has
// installed (Web Speech API voices vary a lot by platform), so this can't be
// three fixed names. Cached per synth instance since getVoices() is stable
// once populated but async on first load in some browsers.
let cachedVoiceMap: Record<string, SpeechSynthesisVoice> | null = null;

function buildVoiceMap(voices: SpeechSynthesisVoice[]): Record<string, SpeechSynthesisVoice> {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = english.length ? english : voices;
  if (!pool.length) return {};

  const used = new Set<string>();
  const takeNext = (preferred?: SpeechSynthesisVoice) => {
    const candidate = preferred && !used.has(preferred.name) ? preferred : pool.find((v) => !used.has(v.name));
    const chosen = candidate || pool[0];
    used.add(chosen.name);
    return chosen;
  };

  const sarah = takeNext(pool.find((v) => FEMALE_VOICE_HINTS.test(v.name)));
  const alex = takeNext(pool.find((v) => MALE_VOICE_HINTS.test(v.name)));
  const dave = takeNext(pool.find((v) => MALE_VOICE_HINTS.test(v.name) && v.name !== alex.name));

  return { sarah, alex, dave };
}

type SpeakOptions = { interrupt?: boolean; onStart?: () => void; onEnd?: () => void };

// The panel introductions arrive as several interviewer_turn events back to
// back with no gap (see backend/api/routes.py's _kick_off_conversation), so
// speakText gets called several times within milliseconds of each other.
// Cancelling on every call (the previous behavior) killed each utterance
// before it could be heard -- only the last one ever played. Queueing
// instead (the browser's speechSynthesis does this natively as long as
// nothing calls .cancel()) lets them play in full, in order. `interrupt`
// stays available for the explicit "replay" action, which really should
// cut off whatever's currently playing.
function speakText(text: string, speaker?: string, options: SpeakOptions = {}): void {
  if (!text || !('speechSynthesis' in window)) {
    options.onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  const trySpeak = () => {
    if (!cachedVoiceMap) cachedVoiceMap = buildVoiceMap(synth.getVoices());
    if (options.interrupt) synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = speaker ? cachedVoiceMap[speaker] : undefined;
    if (voice) utterance.voice = voice;
    utterance.rate = 0.98;
    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = () => options.onEnd?.();
    synth.speak(utterance);
  };
  if (synth.getVoices().length === 0) {
    synth.addEventListener('voiceschanged', trySpeak, { once: true });
  } else {
    trySpeak();
  }
}

function severityStyle(severity: string): { bg: string; text: string } {
  const level = severity.toLowerCase();
  if (level === 'high' || level === 'critical') return { bg: 'bg-[#f7eaea]', text: 'text-[#8a4a4a]' };
  if (level === 'medium') return { bg: 'bg-[#f5ecd9]', text: 'text-[#8a6a30]' };
  return { bg: 'bg-[#eaf3ed]', text: 'text-[#55786b]' };
}

function Interview() {
  const [, setLocation] = useLocation();
  const session = getSession();
  const endSession = useEndSession();
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [findings, setFindings] = useState<AgentFinding[]>([]);
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());

  const micSupported = typeof window !== 'undefined' && Boolean(getSpeechRecognitionCtor());
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // True whenever an interviewer's TTS audio is actually playing. The mic
  // must stay off for the duration -- otherwise it picks up the panel's own
  // voice through the speakers as if the candidate said it, which then
  // triggers another question immediately: a feedback loop that looks
  // exactly like "no one waits for an answer, everyone talks over the last
  // question." `isListening` still tracks what the candidate *wants*;
  // `shouldListen` is the actual gate recognition starts/stops on, so the
  // mic auto-resumes once the interviewer finishes rather than needing a
  // second tap.
  const [isSpeaking, setIsSpeaking] = useState(false);
  const shouldListen = isListening && !isSpeaking;
  const [interimText, setInterimText] = useState('');
  const [saidLines, setSaidLines] = useState<string[]>([]);

  // Driven entirely by the live WebSocket now -- no fixed question list.
  // Every interviewer_turn (scripted introductions or LLM-generated
  // follow-ups alike) updates these the same way.
  const [interviewPhase, setInterviewPhase] = useState<'introductions' | 'interviewing' | 'complete'>('introductions');
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentTopic, setCurrentTopic] = useState<string | null>(null);
  const [currentDifficulty, setCurrentDifficulty] = useState<string | null>(null);
  const [exchangeCount, setExchangeCount] = useState(0);
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);

  // Feedback on the candidate's last answer -- must never be visible before
  // that answer exists, and gets cleared the moment a new question arrives.
  const [recommendedAnswer, setRecommendedAnswer] = useState<{ summary: string; keyPoints: string[]; sampleAnswer: string } | null>(null);
  const [showRecommended, setShowRecommended] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isListeningRef = useRef(false);
  // Counter, not a plain flag: several utterances can be queued at once
  // (the introduction sequence), and isSpeaking must stay true until the
  // *last* one finishes, not flip false the instant any single one ends.
  const pendingSpeechRef = useRef(0);
  const beginSpeaking = () => { pendingSpeechRef.current += 1; setIsSpeaking(true); };
  const endSpeaking = () => { pendingSpeechRef.current = Math.max(0, pendingSpeechRef.current - 1); setIsSpeaking(pendingSpeechRef.current > 0); };

  useEffect(() => { const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);

  // Live agent panel: bridges to the real interview engine over WebSocket
  // (proxied through api-server to the Python backend's /ws/{session_id}).
  // The panel's introductions, every dynamically-generated follow-up
  // question, and the recommended-answer feedback all arrive as events here
  // -- see backend/crew/interview_conductor.py and backend/api/routes.py.
  useEffect(() => {
    if (session.sessionId === 'demo-aura-session') return;
    // In production the api-server can live on a different origin than this
    // static build (e.g. Vercel frontend, Render api-server) -- VITE_API_BASE_URL
    // points the WS handshake there instead of assuming same-origin.
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
    const wsOrigin = apiBaseUrl
      ? `${apiBaseUrl.startsWith('https:') ? 'wss:' : 'ws:'}//${new URL(apiBaseUrl).host}`
      : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    const ws = new WebSocket(`${wsOrigin}/api/ws/${encodeURIComponent(session.sessionId)}`);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('open');
    ws.onclose = () => setWsStatus('closed');
    ws.onerror = () => setWsStatus('closed');
    ws.onmessage = (event) => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.type === 'agent_interrupt' || data.type === 'no_action') {
        const agentsRun = Array.isArray(data.agents_run) ? (data.agents_run as string[]) : [];
        const rawFindings = (data.findings ?? {}) as Record<string, { finding?: string; severity?: string; reasoning?: string }>;
        // Judge only weighs in when a finding above hits "high" severity (see
        // crew/interruption_engine.py's should_run_judge) -- judge_result has
        // the same {finding, severity, reasoning} shape as any other finding,
        // it just isn't keyed into `findings`/`agents_run` since Judge didn't
        // run as part of the routed panel.
        const judgeTriggered = data.judge_triggered === true && data.judge_result && typeof data.judge_result === 'object';
        const speakers = judgeTriggered ? [...agentsRun, 'judge'] : agentsRun;
        if (speakers.length) setActiveAgents(new Set(speakers));

        const agentEntries = agentsRun
          .filter((key) => rawFindings[key])
          .map((key) => ({ key, data: rawFindings[key] }))
          .reverse();
        // Judge's verdict (when triggered) leads the list -- it's the
        // escalation on top of whatever the routed agents already found.
        const newEntries = judgeTriggered
          ? [{ key: 'judge', data: data.judge_result as { finding?: string; severity?: string; reasoning?: string } }, ...agentEntries]
          : agentEntries;

        setFindings((prev) => [
          ...newEntries.map(({ key, data: d }) => ({
            id: `${Date.now()}-${key}`,
            agent: key.charAt(0).toUpperCase() + key.slice(1),
            finding: d.finding || '',
            severity: d.severity || 'low',
            reasoning: d.reasoning || '',
          })),
          ...prev,
        ]);
        return;
      }

      if (data.type === 'recommended_answer') {
        setRecommendedAnswer({
          summary: typeof data.summary === 'string' ? data.summary : '',
          keyPoints: Array.isArray(data.key_points) ? (data.key_points as string[]) : [],
          sampleAnswer: typeof data.sample_answer === 'string' ? data.sample_answer : '',
        });
        setShowRecommended(true);
        return;
      }

      if (data.type === 'interviewer_turn') {
        const speaker = typeof data.speaker === 'string' ? data.speaker : null;
        const text = typeof data.text === 'string' ? data.text : '';
        const phase = data.state === 'complete' ? 'complete' : data.state === 'introductions' ? 'introductions' : 'interviewing';

        setRecommendedAnswer(null);
        setCurrentSpeaker(speaker);
        setCurrentQuestion(text);
        setCurrentTopic(typeof data.topic === 'string' ? data.topic : null);
        setCurrentDifficulty(typeof data.difficulty === 'string' ? data.difficulty : null);
        setInterviewPhase(phase);
        if (phase === 'interviewing') setExchangeCount((n) => n + 1);
        beginSpeaking();
        speakText(text, speaker || undefined, { onEnd: endSpeaking });
        return;
      }

      if (data.type === 'interview_complete') {
        setInterviewPhase('complete');
        setCompleteMessage(typeof data.message === 'string' ? data.message : null);
      }
    };

    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  const replayCurrentQuestion = () => {
    beginSpeaking();
    speakText(currentQuestion, currentSpeaker || undefined, { interrupt: true, onEnd: endSpeaking });
  };

  // Voice input: recognized final phrases are sent to the live agent panel.
  // Gated on shouldListen (isListening AND not isSpeaking), not isListening
  // alone -- letting the mic stay live while an interviewer's TTS plays
  // through the speakers means it picks up that audio as if the candidate
  // said it, immediately triggering another question with no real pause.
  useEffect(() => {
    isListeningRef.current = shouldListen;
    if (!shouldListen) {
      recognitionRef.current?.stop();
      return;
    }
    setMicPermissionDenied(false);
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          setSaidLines((prev) => [...prev, text]);
          wsRef.current?.readyState === WebSocket.OPEN &&
            wsRef.current.send(JSON.stringify({ type: 'transcript_chunk', text }));
        } else {
          interim += text;
        }
      }
      setInterimText(interim);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setMicPermissionDenied(true);
        isListeningRef.current = false;
        setIsListening(false);
      }
    };
    // Some browsers auto-stop a continuous session after a silence timeout --
    // restart transparently unless the user explicitly paused it. Reading
    // isListeningRef (not the `isListening` closed over at effect-creation
    // time, which is always true here) means a stale instance whose owner
    // has since toggled off -- or errored out -- won't keep resurrecting
    // itself independently of React state.
    recognition.onend = () => {
      if (isListeningRef.current && recognitionRef.current === recognition) recognition.start();
    };

    recognitionRef.current = recognition;
    recognition.start();

    return () => {
      recognition.onend = null;
      recognition.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldListen]);

  const time = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const transcript = [...saidLines, interimText].filter(Boolean).join(' ') || 'Say something and the panel will start listening.';
  const micDisabled = !micSupported || interviewPhase === 'complete';
  const heading = interviewPhase === 'complete'
    ? completeMessage || "That's everything from the panel -- whenever you're ready, end the session to see your read."
    : currentQuestion || session.openingPrompt;
  const phaseLabel = interviewPhase === 'introductions' ? 'Introductions' : interviewPhase === 'complete' ? 'Interview complete' : (currentTopic || 'Live question');

  const end = () => {
    setEnding(true);
    setEndError(null);
    recognitionRef.current?.stop();
    endSession.mutate({ sessionId: session.sessionId }, {
      onSuccess: (scorecard) => {
        const card = scorecard as Scorecard;
        setLocation(card.interviewId ? `/scorecard/${card.interviewId}` : '/scorecard');
      },
      onError: (error) => { setEnding(false); setEndError(error instanceof ApiError ? error.message : 'Could not reach the interview engine. Please try again.'); },
    });
  };
  return <div className="page-enter bg-[#efebe4] px-4 py-5 sm:px-8 sm:py-8"><div className="mx-auto max-w-[1250px]"><div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><SectionLabel>Live practice room</SectionLabel><div className="flex items-center gap-3"><span className="font-mono-ui text-[12px] text-[#5e5963]">{time}</span><span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-wider ${wsStatus === 'open' ? 'bg-[#f4dcd6] text-[#9b554a]' : 'bg-[#e9e4da] text-[#8e888d]'}`}><span className={`pulse-dot h-1.5 w-1.5 rounded-full ${wsStatus === 'open' ? 'bg-[#bd5e50]' : 'bg-[#a29aa0]'}`} /> {wsStatus === 'open' ? 'panel connected' : wsStatus === 'connecting' ? 'connecting…' : 'panel disconnected'}</span></div></div><div className="flex items-center gap-2"><span className="mr-2 text-[10px] text-[#a29aa0]">Panel listening</span>{session.agents.map((agent) => <AgentPill agent={agent} key={agent.name} active={agent.name.toLowerCase() === currentSpeaker} />)}</div></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]"><section className="relative overflow-hidden rounded-[25px] bg-[#282738] px-5 pb-6 pt-7 text-[#f9f4ec] shadow-[0_18px_45px_rgba(44,40,56,.14)] sm:px-9 sm:pb-8 sm:pt-9"><div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-[#8c70a7]/25" /><div className="absolute -right-4 -top-10 h-48 w-48 rounded-full border border-[#8c70a7]/20" /><div className="relative z-10 flex items-start justify-between"><div><div className="mb-3 flex items-center gap-2 font-mono-ui text-[9px] uppercase tracking-[.2em] text-[#b8a5c8]"><span className="h-1.5 w-1.5 rounded-full bg-[#9f75bb]" />{currentSpeaker ? `${currentSpeaker.charAt(0).toUpperCase()}${currentSpeaker.slice(1)} · ${phaseLabel}` : phaseLabel}</div><h1 className="max-w-[670px] font-display text-[clamp(29px,4vw,48px)] leading-[1.03] tracking-[-.03em]">{heading}</h1></div><div className="hidden rounded-xl border border-[#49475a] px-3 py-2 text-right sm:block"><div className="font-mono-ui text-[9px] uppercase tracking-widest text-[#898697]">exchange</div><div className="mt-1 text-[12px] text-[#d1cbd0]">{String(exchangeCount).padStart(2, '0')}{currentDifficulty && <span className="text-[#777489]"> · {currentDifficulty}</span>}</div></div></div><div className="relative z-10 mt-16 flex min-h-[155px] items-end justify-center rounded-2xl border border-[#434154] bg-[#302e42] px-6 py-5 sm:mt-20"><div className="absolute left-5 top-5 flex items-center gap-2 text-[10px] text-[#a3a0ad]"><Volume2 size={14} className="text-[#a5d2c3]" /> {!micSupported ? 'Voice input unsupported in this browser' : isSpeaking ? 'Panel is speaking…' : shouldListen ? 'Listening…' : isListening ? 'Waiting for the panel to finish…' : 'Microphone paused'}</div>{shouldListen ? <div className="flex h-20 items-end gap-1.5">{[18,32,56,40,72,45,62,84,47,67,37,59,78,52,30,45,23].map((height, i) => <span key={i} className="wave-bar w-1.5 rounded-full bg-[#a5d2c3] sm:w-2" style={{ height: `${height}%` }} />)}</div> : <div className="font-display text-[23px] text-[#a7a4af]">{isSpeaking ? 'Listening once the panel finishes…' : 'Paused for a breath.'}</div>}</div><div className="relative z-10 mt-5 rounded-2xl bg-[#343246] p-5"><div className="mb-2 flex items-center justify-between"><span className="font-mono-ui text-[9px] uppercase tracking-[.17em] text-[#938e9f]">Live transcript</span></div><p className="text-[13px] leading-6 text-[#d1cdd1]" data-testid="text-live-transcript">{transcript}{shouldListen && <span className="ml-1 inline-block h-4 w-0.5 translate-y-1 bg-[#a5d2c3]" />}</p></div>{recommendedAnswer && <div className="relative z-10 mt-5 rounded-2xl border border-[#4a4560] bg-[#302e42] p-5" data-testid="panel-recommended-answer"><button className="flex w-full items-center justify-between text-left" onClick={() => setShowRecommended((v) => !v)} data-testid="button-toggle-recommended"><span className="flex items-center gap-2 font-mono-ui text-[9px] uppercase tracking-[.17em] text-[#a9d4c6]"><Sparkles size={13} /> Recommended answer</span><ChevronRight size={14} className={`transition-transform ${showRecommended ? 'rotate-90' : ''}`} /></button>{showRecommended && <div className="mt-3 space-y-3">{recommendedAnswer.summary && <p className="text-[12px] leading-5 text-[#d1cdd1]">{recommendedAnswer.summary}</p>}{recommendedAnswer.keyPoints.length > 0 && <ul className="space-y-1.5">{recommendedAnswer.keyPoints.map((point, i) => <li key={i} className="flex gap-2 text-[11px] leading-5 text-[#c3bfd0]"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#a9d4c6]" />{point}</li>)}</ul>}{recommendedAnswer.sampleAnswer && <div className="rounded-xl bg-[#272537] p-3"><div className="mb-1 font-mono-ui text-[9px] uppercase tracking-wide text-[#8f8aa0]">Sample answer</div><p className="text-[11px] italic leading-5 text-[#b8b3c8]">"{recommendedAnswer.sampleAnswer}"</p></div>}</div>}</div>}<div className="relative z-10 mt-7 flex items-center justify-center gap-4"><button disabled={micDisabled} className={`flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#4a485a] transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 ${shouldListen ? 'bg-[#aa7bc1] text-white shadow-[0_0_0_7px_rgba(170,123,193,.14)]' : isListening ? 'bg-[#6b5a7a] text-[#e5dfea]' : 'bg-[#48465a] text-[#c8c3cd]'}`} onClick={() => setIsListening((v) => !v)} data-testid="button-toggle-microphone">{isListening ? <Mic size={22} /> : <Mic size={22} className="opacity-50" />}</button><button disabled={!currentQuestion} className="flex h-10 w-10 items-center justify-center rounded-full border border-[#5a5769] text-[#bab5bf] transition-colors hover:bg-[#403e51] disabled:cursor-not-allowed disabled:opacity-30" onClick={replayCurrentQuestion} data-testid="button-replay-prompt" title="Replay this"><RotateCcw size={16} /></button></div><div className="mt-4 text-center text-[10px] text-[#858294]">{!micSupported ? 'Try Chrome or Edge for live voice input.' : interviewPhase === 'complete' ? 'The panel has what it needs.' : micPermissionDenied ? 'Microphone permission was denied -- check your browser settings.' : isSpeaking ? "The panel is speaking -- you'll be able to respond right after." : isListening ? 'Tap the microphone to pause' : 'Tap the microphone to start speaking'}</div></section>
      <aside className="rounded-[25px] border border-[#e2dcd3] bg-[#fbf8f2] p-5 sm:p-6"><div className="flex items-center justify-between"><div><SectionLabel>Panel notes</SectionLabel><h2 className="font-display text-[27px]">In the room</h2></div><UsersRound size={19} className="text-[#a379bb]" /></div><div className="mt-6 space-y-3">{session.agents.map((agent, i) => { const isBackground = agent.status === 'background'; return <div key={agent.name} className={`rounded-2xl border p-3.5 transition-colors ${agent.name.toLowerCase() === currentSpeaker ? 'border-[#c7aee0] bg-[#f4edf9]' : isBackground ? 'border-dashed border-[#e9e2da] bg-[#f8f4ee] opacity-80' : 'border-[#e9e2da] bg-[#f8f4ee]'}`} data-testid={`card-panel-agent-${i}`} title={isBackground ? `${agent.name} checks evidence in the background -- doesn't ask questions live` : undefined}><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold" style={{ backgroundColor: `${agent.color}25`, color: agent.color }}>{agent.name[0]}</div><div className="flex-1"><div className="text-[11px] font-semibold text-[#504b58]">{agent.name}{isBackground && <span className="ml-1.5 font-mono-ui text-[8px] font-normal uppercase tracking-wide text-[#a39fa8]">background</span>}</div><div className="mt-0.5 text-[10px] text-[#979097]">{agent.role}</div></div><div className={`h-1.5 w-1.5 rounded-full ${activeAgents.has(agent.name.toLowerCase()) ? 'bg-[#bd5e50]' : 'bg-[#7db397]'}`} /></div></div>; })}</div>{findings.length > 0 && <div className="mt-4 max-h-[280px] space-y-2 overflow-y-auto pr-1" data-testid="list-live-findings">{findings.map((f) => { const s = severityStyle(f.severity); return <div key={f.id} className={`rounded-xl ${s.bg} p-3`} data-testid={`card-finding-${f.id}`}><div className={`text-[10px] font-semibold uppercase tracking-wide ${s.text}`}>{f.agent} · {f.severity}</div><p className={`mt-1 text-[11px] leading-5 ${s.text}`}>{f.finding}</p></div>; })}</div>}<div className="mt-6 rounded-2xl border border-[#d5e6dc] bg-[#e9f3ed] p-4"><div className="flex gap-2 text-[#477e6d]"><ShieldCheck size={15} /><span className="text-[11px] font-semibold">Evidence cross-check on</span></div><p className="mt-2 text-[10px] leading-4 text-[#759086]">We’ll gently flag where your story can be backed by your resume or public work.</p></div><button onClick={end} disabled={ending} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-[#dfd3de] bg-[#f9f0f8] py-3 text-[11px] font-semibold text-[#825f99] transition-colors hover:bg-[#eadcf0] disabled:opacity-60" data-testid="button-end-session">{ending ? <LoaderCircle size={15} className="animate-spin" /> : <Square size={13} fill="currentColor" />} {ending ? 'Generating your read…' : 'End session & see my read'}</button>{endError && <p className="mt-3 text-center text-[10px] leading-4 text-[#a35a5a]" data-testid="text-end-error">{endError}</p>}</aside></div></div></div>;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ScorecardListPage() {
  const queryClient = useQueryClient();
  const { data: interviews, isLoading } = useListInterviews({ query: { queryKey: getListInterviewsQueryKey() } });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const deleteInterview = useDeleteInterview({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListInterviewsQueryKey() }) },
  });

  const handleDelete = (e: MouseEvent, interviewId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('Delete this scorecard permanently? This cannot be undone.')) {
      deleteInterview.mutate({ interviewId });
    }
  };

  const handleDownload = async (e: MouseEvent, interview: InterviewSummary) => {
    e.preventDefault();
    e.stopPropagation();
    setDownloadingId(interview.id);
    try {
      const detail = await getInterview(interview.id);
      downloadJson(`auracheck-scorecard-${interview.id}.json`, detail);
    } catch {
      window.alert('Could not download this scorecard. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  return <div className="page-enter mx-auto max-w-[1150px] px-5 py-8 sm:px-8 sm:py-12"><div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><SectionLabel>Interview history</SectionLabel><h1 className="font-display text-[clamp(42px,6vw,68px)] leading-[.94] tracking-[-.045em]">Every read,<br />kept for <em className="text-[#8d67ae]">you.</em></h1><p className="mt-5 max-w-[500px] text-[14px] leading-7 text-[#77727d]">Each practice room is saved on its own — nothing gets overwritten.</p></div><Link href="/setup" className="group inline-flex w-fit items-center gap-2 rounded-full border border-[#cfc2d8] bg-[#f3eaf7] px-4 py-3 text-[11px] font-semibold text-[#805b98] transition-colors hover:bg-[#e8d9ef]" data-testid="link-new-session"><Plus size={15} /> New practice room <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></Link></div>
    {isLoading ? <div className="flex items-center gap-2 text-[12px] text-[#8e888d]"><LoaderCircle size={15} className="animate-spin" /> Loading your history…</div>
    : !interviews || interviews.length === 0 ? <div className="rounded-[25px] border border-dashed border-[#d9d0c3] bg-[#fbf8f2] p-10 text-center" data-testid="empty-interview-history"><p className="text-[13px] leading-6 text-[#8b858d]">You haven't completed a practice room yet. Start one to see your read here.</p></div>
    : <div className="overflow-hidden rounded-[22px] border border-[#e4ddd3] bg-[#fbf8f2]">{interviews.map((interview, i) => <Link key={interview.id} href={`/scorecard/${interview.id}`} className="group flex flex-col gap-3 border-b border-[#e8e1d7] px-5 py-5 transition-colors last:border-0 hover:bg-[#f7f1e8] sm:flex-row sm:items-center sm:justify-between sm:px-7" data-testid={`row-interview-${i}`}><div><div className="text-[14px] font-semibold text-[#3c3949]">{interview.candidateName}{interview.targetRole ? ` · ${interview.targetRole}` : ''}</div><div className="mt-1 text-[11px] text-[#918c93]">{new Date(interview.endedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div></div><div className="flex items-center gap-4"><div className="text-right"><div className="font-mono-ui text-[9px] uppercase tracking-wider text-[#aaa3a5]">Overall</div><div className="mt-1 font-display text-[24px] leading-none text-[#4a3d58]">{interview.overallScore ?? '—'}{interview.overallScore != null && <span className="text-[12px] text-[#a8a0a1]">/100</span>}</div></div><button onClick={(e) => handleDownload(e, interview)} disabled={downloadingId === interview.id} className="rounded-lg p-2 text-[#8e888d] transition-colors hover:bg-[#ece4f2] hover:text-[#805b98] disabled:opacity-50" title="Download as JSON" data-testid={`button-download-${i}`}>{downloadingId === interview.id ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}</button><button onClick={(e) => handleDelete(e, interview.id)} disabled={deleteInterview.isPending} className="rounded-lg p-2 text-[#8e888d] transition-colors hover:bg-[#f6e3e3] hover:text-[#a35a5a] disabled:opacity-50" title="Delete" data-testid={`button-delete-${i}`}><Trash2 size={15} /></button><ChevronRight size={16} className="text-[#8d67ae] opacity-70 transition-transform group-hover:translate-x-0.5" /></div></Link>)}</div>}
  </div>;
}

function ScorecardDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: interview, isLoading, isError } = useGetInterview(params.id, { query: { queryKey: getGetInterviewQueryKey(params.id) } });

  if (isLoading) return <div className="page-enter mx-auto flex max-w-[1150px] items-center gap-2 px-5 py-16 text-[13px] text-[#8e888d] sm:px-8"><LoaderCircle size={16} className="animate-spin" /> Loading this interview…</div>;
  if (isError || !interview) return <div className="page-enter mx-auto max-w-[1150px] px-5 py-16 sm:px-8"><p className="text-[13px] text-[#a35a5a]" data-testid="text-interview-not-found">This interview couldn't be found.</p><Link href="/scorecard" className="mt-4 inline-block text-[12px] font-semibold text-[#8d67ae] hover:underline">Back to history</Link></div>;

  const scorecard = interview.scorecard;
  const hasFlags = scorecard.redFlags.length > 0;
  return <div className="page-enter mx-auto max-w-[1150px] px-5 py-8 sm:px-8 sm:py-12"><div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><SectionLabel>{interview.candidateName}{interview.targetRole ? ` · ${interview.targetRole}` : ''}</SectionLabel><h1 className="font-display text-[clamp(42px,6vw,68px)] leading-[.94] tracking-[-.045em]">You’re closer<br />than you <em className="text-[#8d67ae]">think.</em></h1><p className="mt-5 max-w-[500px] text-[14px] leading-7 text-[#77727d]">A considered read from the full conversation — every dimension weighed together, not scored answer by answer.</p></div><Link href="/setup" className="group inline-flex w-fit items-center gap-2 rounded-full border border-[#cfc2d8] bg-[#f3eaf7] px-4 py-3 text-[11px] font-semibold text-[#805b98] transition-colors hover:bg-[#e8d9ef]" data-testid="link-new-session"><Plus size={15} /> New practice room <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></Link></div><div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]"><div className="relative overflow-hidden rounded-[25px] bg-[#2b2a3b] p-7 text-[#f9f4ec] sm:p-9"><div className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full border border-[#9f7fba]/25" /><SectionLabel>Panel verdict</SectionLabel><div className="relative z-10 mt-7 flex items-center gap-5"><div className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full border-4 border-[#a8d6c8]/30 bg-[#343349]">{scorecard.overallScore != null ? <div className="text-center"><div className="font-display text-[30px] leading-none text-[#a8d6c8]">{scorecard.overallScore}</div><div className="text-[8px] text-[#8a86a0]">/100</div></div> : <ShieldCheck size={40} className="text-[#a8d6c8]" />}</div><div><div className="font-display text-[24px] leading-tight text-[#e8e1e0]" data-testid="text-verdict-headline">{hasFlags ? 'Worth a closer look.' : 'Grounded potential.'}</div><p className="mt-2 text-[11px] leading-5 text-[#aaa6b2]">{hasFlags ? `${scorecard.redFlags.length} flag${scorecard.redFlags.length === 1 ? '' : 's'} for the panel to revisit with you.` : 'No red flags from this session — the panel found your evidence held up.'}</p></div></div>{scorecard.parseWarning && <div className="relative z-10 mt-6 rounded-xl border border-[#5c5670] bg-[#343349] px-4 py-3 text-[10px] leading-4 text-[#c7c2d6]">The panel’s read was incomplete for this session — some sections may be missing.</div>}{scorecard.finalRecommendation && <p className="relative z-10 mt-6 text-[12px] italic leading-5 text-[#d7d2d7]">“{scorecard.finalRecommendation}”</p>}</div><div className="rounded-[25px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><SectionLabel>What the room heard</SectionLabel><p className="mt-5 font-display text-[27px] leading-[1.18] text-[#444051]" data-testid="text-score-summary">“{scorecard.overallAssessment}”</p><div className="mt-7 flex items-center gap-2 text-[10px] text-[#999198]"><ShieldCheck size={14} className="text-[#63927f]" /> Based on your full conversation, resume and public footprint</div></div></div>
    <div className="mt-10"><SectionLabel>Scores by dimension</SectionLabel><div className="grid gap-4 md:grid-cols-2">{scorecard.dimensions.map((dimension, i) => <div key={dimension.label} className="rounded-[20px] border border-[#e4ddd3] bg-[#fbf8f2] p-5 transition-all hover:-translate-y-0.5 hover:shadow-md" data-testid={`card-dimension-${i}`}><div className="flex items-center justify-between"><div className="text-[13px] font-semibold text-[#514b59]">{dimension.label}</div>{dimension.score != null && <div className="font-display text-[20px] text-[#8d67ae]">{dimension.score}</div>}</div><p className="mt-2 text-[11px] leading-5 text-[#8b858d]">{dimension.note}</p></div>)}</div></div>
    <div className="mt-10 grid gap-5 md:grid-cols-2">{scorecard.strengths.length > 0 && <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#65826f]">Strengths</div><div className="space-y-2">{scorecard.strengths.map((item, i) => <div key={i} className="flex gap-3 rounded-xl bg-[#eaf3ed] p-3.5 text-[12px] leading-5 text-[#55786b]"><Check size={16} className="mt-0.5 shrink-0 text-[#5b9a82]" />{item}</div>)}</div></div>}{scorecard.weaknesses.length > 0 && <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a35a5a]">Weaknesses</div><div className="space-y-2">{scorecard.weaknesses.map((item, i) => <div key={i} className="flex gap-3 rounded-xl bg-[#f7eaea] p-3.5 text-[12px] leading-5 text-[#8a4a4a]"><X size={16} className="mt-0.5 shrink-0 text-[#a35a5a]" />{item}</div>)}</div></div>}</div>
    {(scorecard.redFlags.length > 0 || scorecard.mandatoryRepairSteps.length > 0 || scorecard.areasToImprove.length > 0) && <div className="mt-10 grid gap-5 md:grid-cols-2">{scorecard.redFlags.length > 0 && <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a35a5a]">Red flags</div><div className="space-y-2">{scorecard.redFlags.map((flag, i) => <div key={flag} className="flex gap-3 rounded-xl bg-[#f7eaea] p-3.5 text-[12px] leading-5 text-[#8a4a4a]" data-testid={`text-red-flag-${i}`}><X size={16} className="mt-0.5 shrink-0 text-[#a35a5a]" />{flag}</div>)}</div></div>}{(scorecard.mandatoryRepairSteps.length > 0 || scorecard.areasToImprove.length > 0) && <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#65826f]">Areas to improve</div><div className="space-y-2">{[...scorecard.mandatoryRepairSteps, ...scorecard.areasToImprove].map((step, i) => <div key={i} className="flex gap-3 rounded-xl bg-[#eaf3ed] p-3.5 text-[12px] leading-5 text-[#55786b]" data-testid={`text-repair-step-${i}`}><Check size={16} className="mt-0.5 shrink-0 text-[#5b9a82]" />{step}</div>)}</div></div>}</div>}
  </div>;
}

function SettingsPage() {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [evidence, setEvidence] = useState(true);
  const [name, setName] = useState(user?.name || '');
  const save = () => { setSaved(true); window.setTimeout(() => setSaved(false), 2200); };
  return <div className="page-enter mx-auto max-w-[920px] px-5 py-8 sm:px-8 sm:py-12"><div className="mb-10"><SectionLabel>Room settings</SectionLabel><h1 className="font-display text-[clamp(42px,6vw,65px)] leading-[.95] tracking-[-.04em]">Make it feel<br /><em className="text-[#8d67ae]">like you.</em></h1><p className="mt-5 text-[14px] leading-7 text-[#77727d]">Your profile shapes the questions. Your preferences shape the quiet around them.</p></div><div className="space-y-5"><section className="rounded-[24px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><div className="mb-7"><h2 className="font-display text-[29px]">Candidate profile</h2><p className="mt-1 text-[12px] text-[#8e888d]">This is the context your panel carries into each room.</p></div><div className="grid gap-5 sm:grid-cols-2"><label><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] px-4 py-3.5 text-[13px] outline-none focus:border-[#8d67ae]" data-testid="input-settings-name" /></label><label><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Headline</span><input defaultValue="Frontend engineer · builder of useful things" className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] px-4 py-3.5 text-[13px] outline-none focus:border-[#8d67ae]" data-testid="input-settings-headline" /></label></div></section><section className="rounded-[24px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><div className="mb-5"><h2 className="font-display text-[29px]">Room preferences</h2><p className="mt-1 text-[12px] text-[#8e888d]">Small choices that make practice easier to return to.</p></div><div className="divide-y divide-[#ebe4db]"><SettingRow icon={<Bell size={17} />} title="Gentle reminders" description="A nudge when it’s a good time to practice" checked={notifications} onChange={() => setNotifications(!notifications)} testId="switch-notifications" /><SettingRow icon={<ShieldCheck size={17} />} title="Show evidence prompts" description="Let the panel point to proof from your footprint" checked={evidence} onChange={() => setEvidence(!evidence)} testId="switch-evidence" /><SettingRow icon={<Volume2 size={17} />} title="Voice feedback" description="Read prompts and coaching notes aloud" checked={false} onChange={() => undefined} testId="switch-voice" /></div></section><div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div className="flex items-center gap-2 text-[11px] text-[#8e888d]"><LockKeyhole size={14} className="text-[#8d67ae]" /> Your profile is only used to improve your rooms.</div><button onClick={save} className="flex items-center gap-2 rounded-full bg-[#2b2a3b] px-6 py-3.5 text-[12px] font-semibold text-[#faf6ee] transition-all hover:bg-[#8d67ae]" data-testid="button-save-settings">{saved ? <Check size={15} /> : null}{saved ? 'Saved' : 'Save changes'}</button></div></div></div>;
}

function SettingRow({ icon, title, description, checked, onChange, testId }: { icon: ReactNode; title: string; description: string; checked: boolean; onChange: () => void; testId: string }) {
  return <div className="flex items-center gap-4 py-5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eee5f3] text-[#8d67ae]">{icon}</div><div className="flex-1"><div className="text-[13px] font-semibold text-[#514d59]">{title}</div><div className="mt-1 text-[11px] text-[#958e95]">{description}</div></div><button role="switch" aria-checked={checked} onClick={onChange} className={`relative h-6 w-11 rounded-full p-1 transition-colors ${checked ? 'bg-[#8d67ae]' : 'bg-[#d8d1ca]'}`} data-testid={testId}><span className={`block h-4 w-4 rounded-full bg-[#fffaf3] shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>;
}

function AuthedApp() {
  const [location] = useLocation();
  return <RequireAuth><AppShell><ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/setup" component={Setup} /><Route path="/interview" component={Interview} /><Route path="/scorecard" component={ScorecardListPage} /><Route path="/scorecard/:id" component={ScorecardDetailPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></ErrorBoundary></AppShell></RequireAuth>;
}

function Router() {
  return <Switch><Route path="/login" component={LoginPage} /><Route path="/signup" component={SignupPage} /><Route><AuthedApp /></Route></Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><AuthProvider><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></AuthProvider></QueryClientProvider>;
}

export default App;