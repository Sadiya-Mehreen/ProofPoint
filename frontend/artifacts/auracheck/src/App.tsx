import { type ChangeEvent, type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Form } from '@/components/ui/form';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Github,
  Headphones,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
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
  Upload,
  UsersRound,
  Volume2,
  X,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import {
  ApiError,
  getHealthCheckQueryKey,
  getGetGithubFootprintQueryKey,
  useEndSession,
  useGetGithubFootprint,
  useHealthCheck,
  useStartSession,
  useUploadResume,
} from '@workspace/api-client-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const logoPath = '/assets/auracheck-logo.jpg';

type Agent = { name: string; role: string; color: string; status: string };
type Session = { sessionId: string; status: string; openingPrompt: string; agents: Agent[] };
type Scorecard = { sessionId: string; overallAssessment: string; dimensions: { label: string; note: string }[]; redFlags: string[]; mandatoryRepairSteps: string[]; parseWarning: boolean };
type SetupValues = { candidateName: string; targetRole: string; githubUsername: string; resumeName: string };

const demoAgents: Agent[] = [
  { name: 'Mira', role: 'Clarity coach', color: '#9b77bd', status: 'ready' },
  { name: 'Owen', role: 'Technical depth', color: '#65aa9a', status: 'ready' },
  { name: 'Jules', role: 'Story & impact', color: '#e7a96b', status: 'ready' },
  { name: 'Anika', role: 'Role fit', color: '#7ba6c3', status: 'ready' },
  { name: 'Sol', role: 'Evidence check', color: '#cf7c88', status: 'ready' },
];

const demoSession: Session = {
  sessionId: 'demo-aura-session',
  status: 'ready',
  openingPrompt: 'Welcome, Arjun. Let’s start with the work you’re most proud of — what made it matter?',
  agents: demoAgents,
};

const demoScorecard: Scorecard = {
  sessionId: 'demo-aura-session',
  overallAssessment: 'You bring considered thinking and credible technical range. The next lift is making your impact easier to feel in the first 30 seconds.',
  dimensions: [
    { label: 'Reality vs. resume', note: 'Your public repositories back up the projects you described.' },
    { label: 'Technical integrity', note: 'Good fundamentals with room for sharper trade-off language.' },
    { label: 'Communication', note: 'Strong structure. Lead with the outcome before the process.' },
    { label: 'Domain strategy', note: 'Your framing was plausible and appropriately scoped for the role.' },
  ],
  redFlags: [],
  mandatoryRepairSteps: ['Make your impact easier to feel in the first 30 seconds of an answer.'],
  parseWarning: false,
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
function saveScorecard(scorecard: Scorecard) {
  sessionStorage.setItem('auracheck-scorecard', JSON.stringify(scorecard));
}
function getScorecard(): Scorecard {
  try {
    return JSON.parse(sessionStorage.getItem('auracheck-scorecard') || 'null') || demoScorecard;
  } catch {
    return demoScorecard;
  }
}

function Logo({ compact = false }: { compact?: boolean }) {
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
      {!compact && <div><div className="font-display text-[23px] leading-none tracking-[-.04em] text-[#f8f4ed]">aura<span className="text-[#9ccfc0]">Check</span></div><div className="mt-1 text-[8px] uppercase tracking-[.23em] text-[#9da0b1]">from vibe to verified</div></div>}
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
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
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[12px] text-[#8e91a4] transition-colors hover:bg-[#303044] hover:text-[#f5f1e9]" data-testid="button-log-out"><LogOut size={16} /> Sign out</button>
          <div className="mt-3 flex items-center gap-3 border-t border-[#39394c] px-2 pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#93c8b9] font-mono-ui text-[11px] text-[#233c39]">AM</div>
            <div><div className="text-[12px] font-semibold text-[#ece8e0]">Arjun Mehta</div><div className="text-[10px] text-[#898b9d]">Candidate profile</div></div>
          </div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-[#1d1e2a]/60 md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-dismiss-menu" />}
      <div className="min-w-0 md:pl-[238px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[#e5dfd5] bg-[#f5f1e9]/90 px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3"><button className="rounded-lg p-2 text-[#5d5b6b] hover:bg-[#ebe5dc] md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={19} /></button><span className="hidden font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#99949b] sm:inline">Monday, 08 April 2024</span></div>
          <div className="flex items-center gap-2 sm:gap-4"><button className="relative rounded-xl p-2 text-[#77717d] transition-colors hover:bg-[#ebe5dc]" data-testid="button-notifications"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#a374ba]" /></button><div className="hidden h-5 w-px bg-[#dfd8ce] sm:block" /><Link href="/settings" className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-[#ebe5dc]" data-testid="link-header-profile"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d5e9df] font-mono-ui text-[10px] font-medium text-[#326153]">AM</div><span className="hidden text-[12px] font-semibold text-[#444252] sm:inline">Arjun Mehta</span></Link></div>
        </header>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.19em] text-[#99929a]"><span className="h-1.5 w-1.5 rounded-full bg-[#a378bc]" />{children}</div>;
}

function Home() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const [showAll, setShowAll] = useState(false);
  const sessions = [
    { role: 'Product designer', date: 'Today, 10:42 AM', score: '78', tone: 'Practice room', color: '#8d67ae' },
    { role: 'Frontend engineer', date: '04 Apr 2024', score: '71', tone: 'Final rehearsal', color: '#65aa9a' },
    { role: 'Growth analyst', date: '28 Mar 2024', score: '64', tone: 'First session', color: '#e4a26a' },
  ];
  return (
    <div className="page-enter mx-auto max-w-[1340px] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div><div className="mb-4 flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#8d67ae]"><span className="pulse-dot h-2 w-2 rounded-full bg-[#8d67ae]" /> {health.isLoading ? 'Checking your room' : health.isError ? 'Demo room · ready to explore' : 'Your room is ready'}</div><h1 className="font-display text-[clamp(40px,5vw,68px)] leading-[.93] tracking-[-.04em] text-[#262536]">Make your next<br /><em className="text-[#8d67ae]">yes</em> feel earned.</h1><p className="mt-5 max-w-[470px] text-[15px] leading-7 text-[#73707b]">A little practice, a little proof, and a clearer version of you in the room.</p></div>
        <Link href="/setup" className="group inline-flex w-fit items-center gap-3 rounded-full bg-[#2b2a3b] px-5 py-3.5 text-[12px] font-semibold text-[#faf6ee] transition-all hover:-translate-y-0.5 hover:bg-[#8d67ae] hover:shadow-lg hover:shadow-[#8d67ae]/20" data-testid="link-start-practice"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#9ccfc0] text-[#203331]"><Plus size={14} /></span> Start a practice room <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></Link>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_.9fr]">
        <div className="relative overflow-hidden rounded-[26px] bg-[#2a293a] p-6 text-[#f7f2ea] shadow-[0_16px_45px_rgba(44,40,56,.12)] sm:p-8">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border border-[#9e7cbd]/30" /><div className="absolute -right-5 -top-9 h-44 w-44 rounded-full border border-[#9e7cbd]/20" />
          <div className="relative z-10 flex items-start justify-between"><div><SectionLabel>Momentum</SectionLabel><h2 className="font-display text-[32px] tracking-[-.02em]">Your signal is getting clearer.</h2></div><div className="rounded-full border border-[#555067] px-3 py-1.5 font-mono-ui text-[10px] text-[#b1aec0]">03 sessions</div></div>
          <div className="relative z-10 mt-10 flex items-end gap-8"><div><div className="font-display text-[76px] leading-none text-[#a5d6c8]">78</div><div className="mt-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#a5a2b2]">latest confidence</div></div><div className="pb-1"><div className="mb-2 flex items-center gap-2 text-[12px] text-[#d7d2d7]"><span className="h-2 w-2 rounded-full bg-[#a5d6c8]" /> +14 points since first room</div><div className="h-1.5 w-44 overflow-hidden rounded-full bg-[#4e4b5e]"><div className="h-full w-[78%] rounded-full bg-[#a5d6c8]" /></div></div></div>
          <div className="relative z-10 mt-8 flex items-end gap-1.5 border-t border-[#444356] pt-5">{[32, 45, 39, 53, 47, 66, 62, 78, 72, 82, 78, 92].map((height, i) => <div key={i} className="flex-1 rounded-t-sm bg-[#8d67ae]" style={{ height: `${height * .48}px`, opacity: .38 + i / 20 }} />)}<div className="ml-3 self-end font-mono-ui text-[9px] text-[#888697]">last 12 weeks</div></div>
        </div>
        <div className="rounded-[26px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><SectionLabel>Next best move</SectionLabel><div className="mt-6 flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe2f6] text-[#8d67ae]"><Headphones size={20} /></div><div><h2 className="font-display text-[26px] leading-tight text-[#343243]">Rehearse your opening.</h2><p className="mt-2 text-[13px] leading-6 text-[#77727d]">Your ideas are strong. Let’s make the first 30 seconds impossible to miss.</p></div></div><Link href="/setup" className="mt-8 flex items-center justify-between border-t border-[#e7e0d7] pt-4 text-[12px] font-semibold text-[#8d67ae] transition-colors hover:text-[#68478a]" data-testid="link-rehearse-opening">Open a focused room <ArrowRight size={15} /></Link></div>
      </div>
      <div className="mt-12"><div className="mb-5 flex items-end justify-between"><div><SectionLabel>Preparation log</SectionLabel><h2 className="font-display text-[30px] tracking-[-.02em]">Recent rooms</h2></div><button className="text-[11px] font-semibold text-[#8d67ae] hover:underline" onClick={() => setShowAll(!showAll)} data-testid="button-toggle-sessions">{showAll ? 'Show less' : 'View all sessions'}</button></div>
        <div className="overflow-hidden rounded-[22px] border border-[#e4ddd3] bg-[#fbf8f2]">{sessions.slice(0, showAll ? 3 : 2).map((session, i) => <div key={session.role} className="group flex flex-col gap-4 border-b border-[#e8e1d7] px-5 py-5 transition-colors last:border-0 hover:bg-[#f7f1e8] sm:flex-row sm:items-center sm:px-7" data-testid={`row-session-${i}`}><div className="flex flex-1 items-center gap-4"><div className="relative flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-bold" style={{ backgroundColor: `${session.color}20`, color: session.color }}>{i === 0 ? <Mic size={17} /> : <BarChart3 size={17} />}<span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#fbf8f2] bg-[#8dc7a9]" /></div><div><div className="text-[14px] font-semibold text-[#3c3949]">{session.role}</div><div className="mt-1 flex items-center gap-2 text-[11px] text-[#918c93]"><span>{session.date}</span><span className="h-1 w-1 rounded-full bg-[#bdb5b5]" /><span>{session.tone}</span></div></div></div><div className="flex items-center gap-7 pl-14 sm:pl-0"><div><div className="font-mono-ui text-[9px] uppercase tracking-wider text-[#aaa3a5]">Aura score</div><div className="mt-1 font-display text-[26px] leading-none text-[#4a3d58]">{session.score}<span className="text-[13px] text-[#a8a0a1]">/100</span></div></div><button className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e0d8d0] text-[#8d67ae] opacity-70 transition-all hover:border-[#8d67ae] hover:opacity-100" data-testid={`button-open-session-${i}`}><ChevronRight size={16} /></button></div></div>)}</div>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-[#e4ddd3] bg-[#ede3f4] p-5"><div className="flex items-center justify-between"><Sparkles size={18} className="text-[#8d67ae]" /><span className="font-mono-ui text-[10px] text-[#8d67ae]">this month</span></div><div className="mt-7 font-display text-[33px]">3</div><p className="mt-1 text-[11px] text-[#706879]">practice rooms completed</p></div><div className="rounded-2xl border border-[#d8e8e0] bg-[#e0f0e8] p-5"><div className="flex items-center justify-between"><ShieldCheck size={18} className="text-[#397767]" /><span className="font-mono-ui text-[10px] text-[#397767]">verified</span></div><div className="mt-7 font-display text-[33px]">12</div><p className="mt-1 text-[11px] text-[#5d766d]">evidence points gathered</p></div><div className="rounded-2xl border border-[#eadfce] bg-[#f5e9d7] p-5"><div className="flex items-center justify-between"><BookOpen size={18} className="text-[#aa7542]" /><span className="font-mono-ui text-[10px] text-[#aa7542]">focus area</span></div><div className="mt-7 font-display text-[25px] leading-none">Openings</div><p className="mt-2 text-[11px] text-[#806b57]">the next small unlock</p></div></div>
    </div>
  );
}

function Setup() {
  const [, setLocation] = useLocation();
  const startSession = useStartSession();
  const uploadResume = useUploadResume();
  const [resumeName, setResumeName] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeStatus, setResumeStatus] = useState<'idle' | 'selected' | 'uploading' | 'done' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<SetupValues>({ defaultValues: { candidateName: 'Arjun Mehta', targetRole: 'Frontend Engineer', githubUsername: '', resumeName: '' } });
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
  return <div className={`flex items-center gap-2.5 rounded-full border px-2.5 py-1.5 transition-all ${active ? 'border-[#9d7db8] bg-[#eee4f5]' : 'border-[#e3dfe5] bg-[#f8f5f8]'}`} data-testid={`agent-${agent.name.toLowerCase()}`}><div className="relative flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold" style={{ backgroundColor: `${agent.color}2a`, color: agent.color }}>{agent.name[0]}<span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-[#f8f5f8] bg-[#7db397]" /></div><div className="hidden text-[10px] font-semibold text-[#5e5965] sm:block">{agent.name}</div></div>;
}

function Interview() {
  const [, setLocation] = useLocation();
  const session = getSession();
  const endSession = useEndSession();
  const [isListening, setIsListening] = useState(true);
  const [elapsed, setElapsed] = useState(132);
  const [transcript, setTranscript] = useState('I’m most proud of the campus collaboration tool I built with two friends. We noticed students were losing project context between chats, docs, and task boards…');
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  const time = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const end = () => {
    setEnding(true);
    setEndError(null);
    endSession.mutate({ sessionId: session.sessionId }, {
      onSuccess: (scorecard) => { saveScorecard(scorecard as Scorecard); setLocation('/scorecard'); },
      onError: (error) => { setEnding(false); setEndError(error instanceof ApiError ? error.message : 'Could not reach the interview engine. Please try again.'); },
    });
  };
  return <div className="page-enter bg-[#efebe4] px-4 py-5 sm:px-8 sm:py-8"><div className="mx-auto max-w-[1250px]"><div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><SectionLabel>Live practice room</SectionLabel><div className="flex items-center gap-3"><span className="font-mono-ui text-[12px] text-[#5e5963]">{time}</span><span className="flex items-center gap-1.5 rounded-full bg-[#f4dcd6] px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-wider text-[#9b554a]"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#bd5e50]" /> recording</span></div></div><div className="flex items-center gap-2"><span className="mr-2 text-[10px] text-[#a29aa0]">Panel listening</span>{session.agents.map((agent) => <AgentPill agent={agent} key={agent.name} active={agent.name === 'Mira'} />)}</div></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]"><section className="relative overflow-hidden rounded-[25px] bg-[#282738] px-5 pb-6 pt-7 text-[#f9f4ec] shadow-[0_18px_45px_rgba(44,40,56,.14)] sm:px-9 sm:pb-8 sm:pt-9"><div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-[#8c70a7]/25" /><div className="absolute -right-4 -top-10 h-48 w-48 rounded-full border border-[#8c70a7]/20" /><div className="relative z-10 flex items-start justify-between"><div><div className="mb-3 flex items-center gap-2 font-mono-ui text-[9px] uppercase tracking-[.2em] text-[#b8a5c8]"><span className="h-1.5 w-1.5 rounded-full bg-[#9f75bb]" />Mira is asking</div><h1 className="max-w-[670px] font-display text-[clamp(29px,4vw,48px)] leading-[1.03] tracking-[-.03em]">Tell me about a project you’re <em className="text-[#a9d4c6]">most proud of.</em></h1></div><div className="hidden rounded-xl border border-[#49475a] px-3 py-2 text-right sm:block"><div className="font-mono-ui text-[9px] uppercase tracking-widest text-[#898697]">question</div><div className="mt-1 text-[12px] text-[#d1cbd0]">02 <span className="text-[#777489]">/ 06</span></div></div></div><div className="relative z-10 mt-16 flex min-h-[155px] items-end justify-center rounded-2xl border border-[#434154] bg-[#302e42] px-6 py-5 sm:mt-20"><div className="absolute left-5 top-5 flex items-center gap-2 text-[10px] text-[#a3a0ad]"><Volume2 size={14} className="text-[#a5d2c3]" /> Your voice is clear</div>{isListening ? <div className="flex h-20 items-end gap-1.5">{[18,32,56,40,72,45,62,84,47,67,37,59,78,52,30,45,23].map((height, i) => <span key={i} className="wave-bar w-1.5 rounded-full bg-[#a5d2c3] sm:w-2" style={{ height: `${height}%` }} />)}</div> : <div className="font-display text-[23px] text-[#a7a4af]">Paused for a breath.</div>}</div><div className="relative z-10 mt-5 rounded-2xl bg-[#343246] p-5"><div className="mb-2 flex items-center justify-between"><span className="font-mono-ui text-[9px] uppercase tracking-[.17em] text-[#938e9f]">Live transcript</span><span className="text-[10px] text-[#7e7a8d]">just now</span></div><p className="text-[13px] leading-6 text-[#d1cdd1]" data-testid="text-live-transcript">{transcript}<span className="ml-1 inline-block h-4 w-0.5 translate-y-1 bg-[#a5d2c3]" /></p></div><div className="relative z-10 mt-7 flex items-center justify-center gap-4"><button className={`flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#4a485a] transition-all hover:scale-105 ${isListening ? 'bg-[#aa7bc1] text-white shadow-[0_0_0_7px_rgba(170,123,193,.14)]' : 'bg-[#48465a] text-[#c8c3cd]'}`} onClick={() => setIsListening(!isListening)} data-testid="button-toggle-microphone">{isListening ? <Mic size={22} /> : <Mic size={22} className="opacity-50" />}</button><button className="flex h-10 w-10 items-center justify-center rounded-full border border-[#5a5769] text-[#bab5bf] transition-colors hover:bg-[#403e51]" onClick={() => setTranscript('Take your time. The panel is listening for the choice you made and what changed because of it.')} data-testid="button-replay-prompt"><RotateCcw size={16} /></button></div><div className="mt-4 text-center text-[10px] text-[#858294]">{isListening ? 'Tap the microphone when you’ve finished your thought' : 'Microphone paused · tap to continue'}</div></section>
      <aside className="rounded-[25px] border border-[#e2dcd3] bg-[#fbf8f2] p-5 sm:p-6"><div className="flex items-center justify-between"><div><SectionLabel>Panel notes</SectionLabel><h2 className="font-display text-[27px]">In the room</h2></div><UsersRound size={19} className="text-[#a379bb]" /></div><div className="mt-6 space-y-3">{session.agents.map((agent, i) => <div key={agent.name} className="rounded-2xl border border-[#e9e2da] bg-[#f8f4ee] p-3.5" data-testid={`card-panel-agent-${i}`}><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold" style={{ backgroundColor: `${agent.color}25`, color: agent.color }}>{agent.name[0]}</div><div className="flex-1"><div className="text-[11px] font-semibold text-[#504b58]">{agent.name}</div><div className="mt-0.5 text-[10px] text-[#979097]">{agent.role}</div></div><div className="h-1.5 w-1.5 rounded-full bg-[#7db397]" /></div>{i === 0 && <div className="mt-3 border-t border-[#e9e2da] pt-3 text-[10px] leading-4 text-[#8b8490]">Listening for a clear <span className="font-semibold text-[#786487]">situation → choice → change</span> thread.</div>}</div>)}</div><div className="mt-6 rounded-2xl border border-[#d5e6dc] bg-[#e9f3ed] p-4"><div className="flex gap-2 text-[#477e6d]"><ShieldCheck size={15} /><span className="text-[11px] font-semibold">Evidence cross-check on</span></div><p className="mt-2 text-[10px] leading-4 text-[#759086]">We’ll gently flag where your story can be backed by your resume or public work.</p></div><button onClick={end} disabled={ending} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-[#dfd3de] bg-[#f9f0f8] py-3 text-[11px] font-semibold text-[#825f99] transition-colors hover:bg-[#eadcf0] disabled:opacity-60" data-testid="button-end-session">{ending ? <LoaderCircle size={15} className="animate-spin" /> : <Square size={13} fill="currentColor" />} {ending ? 'Generating your read…' : 'End session & see my read'}</button>{endError && <p className="mt-3 text-center text-[10px] leading-4 text-[#a35a5a]" data-testid="text-end-error">{endError}</p>}</aside></div></div></div>;
}

function ScorecardPage() {
  const scorecard = getScorecard();
  const [activeTab, setActiveTab] = useState<'read' | 'next'>('read');
  const hasFlags = scorecard.redFlags.length > 0;
  return <div className="page-enter mx-auto max-w-[1150px] px-5 py-8 sm:px-8 sm:py-12"><div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><SectionLabel>Your verified read</SectionLabel><h1 className="font-display text-[clamp(42px,6vw,68px)] leading-[.94] tracking-[-.045em]">You’re closer<br />than you <em className="text-[#8d67ae]">think.</em></h1><p className="mt-5 max-w-[500px] text-[14px] leading-7 text-[#77727d]">A considered first read from the room. Keep what feels true; use the rest as your next rehearsal.</p></div><Link href="/setup" className="group inline-flex w-fit items-center gap-2 rounded-full border border-[#cfc2d8] bg-[#f3eaf7] px-4 py-3 text-[11px] font-semibold text-[#805b98] transition-colors hover:bg-[#e8d9ef]" data-testid="link-new-session"><Plus size={15} /> New practice room <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></Link></div><div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]"><div className="relative overflow-hidden rounded-[25px] bg-[#2b2a3b] p-7 text-[#f9f4ec] sm:p-9"><div className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full border border-[#9f7fba]/25" /><SectionLabel>Panel verdict</SectionLabel><div className="relative z-10 mt-7 flex items-center gap-5"><div className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full border-4 border-[#a8d6c8]/30 bg-[#343349]"><ShieldCheck size={40} className="text-[#a8d6c8]" /></div><div><div className="font-display text-[24px] leading-tight text-[#e8e1e0]" data-testid="text-verdict-headline">{hasFlags ? 'Worth a closer look.' : 'Grounded potential.'}</div><p className="mt-2 text-[11px] leading-5 text-[#aaa6b2]">{hasFlags ? `${scorecard.redFlags.length} flag${scorecard.redFlags.length === 1 ? '' : 's'} for the panel to revisit with you.` : 'No red flags from this session — the panel found your evidence held up.'}</p></div></div>{scorecard.parseWarning && <div className="relative z-10 mt-6 rounded-xl border border-[#5c5670] bg-[#343349] px-4 py-3 text-[10px] leading-4 text-[#c7c2d6]">The panel’s read was incomplete for this session — some sections may be missing.</div>}</div><div className="rounded-[25px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><div className="flex items-center justify-between"><SectionLabel>What the room heard</SectionLabel><div className="flex rounded-lg bg-[#f0ebe4] p-1"><button onClick={() => setActiveTab('read')} className={`rounded-md px-3 py-1.5 text-[10px] font-semibold ${activeTab === 'read' ? 'bg-[#fbf8f2] text-[#645269] shadow-sm' : 'text-[#999198]'}`} data-testid="button-scorecard-read">Read</button><button onClick={() => setActiveTab('next')} className={`rounded-md px-3 py-1.5 text-[10px] font-semibold ${activeTab === 'next' ? 'bg-[#fbf8f2] text-[#645269] shadow-sm' : 'text-[#999198]'}`} data-testid="button-scorecard-evidence">Next steps</button></div></div>{activeTab === 'read' ? <p className="mt-5 font-display text-[27px] leading-[1.18] text-[#444051]" data-testid="text-score-summary">“{scorecard.overallAssessment}”</p> : <div className="mt-5 space-y-4">{scorecard.redFlags.length > 0 && <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a35a5a]">Red flags</div><div className="space-y-2">{scorecard.redFlags.map((flag, i) => <div key={flag} className="flex gap-3 rounded-xl bg-[#f7eaea] p-3.5 text-[12px] leading-5 text-[#8a4a4a]" data-testid={`text-red-flag-${i}`}><X size={16} className="mt-0.5 shrink-0 text-[#a35a5a]" />{flag}</div>)}</div></div>}{scorecard.mandatoryRepairSteps.length > 0 && <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#65826f]">Repair steps</div><div className="space-y-2">{scorecard.mandatoryRepairSteps.map((step, i) => <div key={step} className="flex gap-3 rounded-xl bg-[#eaf3ed] p-3.5 text-[12px] leading-5 text-[#55786b]" data-testid={`text-repair-step-${i}`}><Check size={16} className="mt-0.5 shrink-0 text-[#5b9a82]" />{step}</div>)}</div></div>}{scorecard.redFlags.length === 0 && scorecard.mandatoryRepairSteps.length === 0 && <p className="text-[12px] leading-5 text-[#8b858d]">Nothing specific flagged — you’re in good shape.</p>}</div>}<div className="mt-7 flex items-center gap-2 text-[10px] text-[#999198]"><ShieldCheck size={14} className="text-[#63927f]" /> Based on your conversation, resume and public footprint</div></div></div>
    <div className="mt-10"><SectionLabel>Four useful signals</SectionLabel><div className="grid gap-4 md:grid-cols-2">{scorecard.dimensions.map((dimension, i) => <div key={dimension.label} className="rounded-[20px] border border-[#e4ddd3] bg-[#fbf8f2] p-5 transition-all hover:-translate-y-0.5 hover:shadow-md" data-testid={`card-dimension-${i}`}><div className="text-[13px] font-semibold text-[#514b59]">{dimension.label}</div><p className="mt-2 text-[11px] leading-5 text-[#8b858d]">{dimension.note}</p></div>)}</div></div></div>;
}

function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [evidence, setEvidence] = useState(true);
  const [name, setName] = useState('Arjun Mehta');
  const save = () => { setSaved(true); window.setTimeout(() => setSaved(false), 2200); };
  return <div className="page-enter mx-auto max-w-[920px] px-5 py-8 sm:px-8 sm:py-12"><div className="mb-10"><SectionLabel>Room settings</SectionLabel><h1 className="font-display text-[clamp(42px,6vw,65px)] leading-[.95] tracking-[-.04em]">Make it feel<br /><em className="text-[#8d67ae]">like you.</em></h1><p className="mt-5 text-[14px] leading-7 text-[#77727d]">Your profile shapes the questions. Your preferences shape the quiet around them.</p></div><div className="space-y-5"><section className="rounded-[24px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><div className="mb-7"><h2 className="font-display text-[29px]">Candidate profile</h2><p className="mt-1 text-[12px] text-[#8e888d]">This is the context your panel carries into each room.</p></div><div className="grid gap-5 sm:grid-cols-2"><label><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] px-4 py-3.5 text-[13px] outline-none focus:border-[#8d67ae]" data-testid="input-settings-name" /></label><label><span className="mb-2 block text-[11px] font-semibold text-[#625e69]">Headline</span><input defaultValue="Frontend engineer · builder of useful things" className="w-full rounded-xl border border-[#ded7ce] bg-[#f7f3ec] px-4 py-3.5 text-[13px] outline-none focus:border-[#8d67ae]" data-testid="input-settings-headline" /></label></div></section><section className="rounded-[24px] border border-[#e4ddd3] bg-[#fbf8f2] p-6 sm:p-8"><div className="mb-5"><h2 className="font-display text-[29px]">Room preferences</h2><p className="mt-1 text-[12px] text-[#8e888d]">Small choices that make practice easier to return to.</p></div><div className="divide-y divide-[#ebe4db]"><SettingRow icon={<Bell size={17} />} title="Gentle reminders" description="A nudge when it’s a good time to practice" checked={notifications} onChange={() => setNotifications(!notifications)} testId="switch-notifications" /><SettingRow icon={<ShieldCheck size={17} />} title="Show evidence prompts" description="Let the panel point to proof from your footprint" checked={evidence} onChange={() => setEvidence(!evidence)} testId="switch-evidence" /><SettingRow icon={<Volume2 size={17} />} title="Voice feedback" description="Read prompts and coaching notes aloud" checked={false} onChange={() => undefined} testId="switch-voice" /></div></section><div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div className="flex items-center gap-2 text-[11px] text-[#8e888d]"><LockKeyhole size={14} className="text-[#8d67ae]" /> Your profile is only used to improve your rooms.</div><button onClick={save} className="flex items-center gap-2 rounded-full bg-[#2b2a3b] px-6 py-3.5 text-[12px] font-semibold text-[#faf6ee] transition-all hover:bg-[#8d67ae]" data-testid="button-save-settings">{saved ? <Check size={15} /> : null}{saved ? 'Saved' : 'Save changes'}</button></div></div></div>;
}

function SettingRow({ icon, title, description, checked, onChange, testId }: { icon: ReactNode; title: string; description: string; checked: boolean; onChange: () => void; testId: string }) {
  return <div className="flex items-center gap-4 py-5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eee5f3] text-[#8d67ae]">{icon}</div><div className="flex-1"><div className="text-[13px] font-semibold text-[#514d59]">{title}</div><div className="mt-1 text-[11px] text-[#958e95]">{description}</div></div><button role="switch" aria-checked={checked} onClick={onChange} className={`relative h-6 w-11 rounded-full p-1 transition-colors ${checked ? 'bg-[#8d67ae]' : 'bg-[#d8d1ca]'}`} data-testid={testId}><span className={`block h-4 w-4 rounded-full bg-[#fffaf3] shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>;
}

function Router() {
  const [location] = useLocation();
  return <AppShell><ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/setup" component={Setup} /><Route path="/interview" component={Interview} /><Route path="/scorecard" component={ScorecardPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></ErrorBoundary></AppShell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;