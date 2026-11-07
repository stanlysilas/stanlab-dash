import { useCallback, useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { Activity, AppWindow, ArrowDownToLine, ArrowUpFromLine, CircleAlert, Cpu, Download, ExternalLink, HardDrive, House, ImagePlus, Images, LogOut, MemoryStick, Play, Plus, RefreshCw, Server, ShieldCheck, Sparkles, Store, Trash2, Tv } from 'lucide-react';
import { api, formatBytes, type ConfiguredScript, type Metrics } from './lib/api';
import { readWallpaper, saveWallpaper } from './lib/wallpaper';
import { Button, Field, Notice } from './components/ui';

type Session = { authenticated: true; username: string; hostname: string; expiresInMs: number };
type Capabilities = { displayManagerEnabled: boolean; scripts: ConfiguredScript[] };
type DashboardApp = { id: string; name: string; url: string };
type DashboardTab = 'overview' | 'applications' | 'store' | 'controls';
type StoreApp = { id: string; name: string; category: string; description: string; image: string; containerPort: number; volumes: Array<{ name: string; target: string }>; notes: string[]; installed: boolean; status: 'available' | 'running' | 'stopped'; port: number | null; installedAt: string | null };
type StoreData = { runtime: string | null; runtimeAvailable: boolean; apps: StoreApp[] };
type StoreAction = 'install' | 'start' | 'stop' | 'restart' | 'update' | 'uninstall';
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionEndsAt, setSessionEndsAt] = useState(0);

  const signOut = useCallback(async (expired = false) => {
    if (!expired) await api<void>('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSession(null);
    setSessionEndsAt(0);
  }, []);

  useEffect(() => {
    let active = true;
    api<Session>('/api/auth/session')
      .then((value) => { if (active) { setSession(value); setSessionEndsAt(Date.now() + value.expiresInMs); } })
      .catch(() => undefined)
      .finally(() => { if (active) setChecking(false); });
    const onUnauthorized = () => { setSession(null); setSessionEndsAt(0); };
    window.addEventListener('stanlab:unauthorized', onUnauthorized);
    return () => { active = false; window.removeEventListener('stanlab:unauthorized', onUnauthorized); };
  }, []);

  if (checking) return <div className="grid min-h-screen place-items-center text-sm text-zinc-500">Loading dashboard…</div>;
  return session ? <Dashboard session={session} expiresAt={sessionEndsAt} onSignOut={() => signOut()} /> : <Login onSuccess={(value) => { setSession(value); setSessionEndsAt(Date.now() + value.expiresInMs); }} />;
}

function Login({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const value = await api<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      onSuccess(value);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }

  return <main className="relative grid min-h-screen place-items-center px-5 py-12">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.035),transparent_60%)]" />
    <div className="relative w-full max-w-[440px] rounded-xl border border-[#3a3f46] bg-[#151719] p-8 shadow-2xl shadow-black/20 sm:p-10">
      <div className="text-[15px] font-bold tracking-[0.04em] text-zinc-100">STANLAB</div>
      <h1 className="mt-7 text-[34px] font-semibold leading-none tracking-[-0.045em] text-zinc-50">Sign in</h1>
      <form className="mt-8 space-y-5" onSubmit={submit}>
        <label className="block space-y-2"><span className="text-sm text-zinc-400">Username</span><Field autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus required /></label>
        <label className="block space-y-2"><span className="text-sm text-zinc-400">Password</span><Field type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div role="alert" className="flex gap-2 text-sm leading-5 text-rose-300"><CircleAlert size={17} className="mt-0.5 shrink-0" />{error}</div>}
        <Button type="submit" disabled={busy} className="mt-1 w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className="mt-5 text-sm text-zinc-400">Sessions expire after 15 minutes.</p>
    </div>
  </main>;
}

function Dashboard({ session, expiresAt, onSignOut }: { session: Session; expiresAt: number; onSignOut: () => void }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({ displayManagerEnabled: false, scripts: [] });
  const [message, setMessage] = useState<{ text: string; tone: 'neutral' | 'warning' | 'success' } | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [now, setNow] = useState(Date.now());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [scriptOutput, setScriptOutput] = useState('');
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => tabFromHash());
  const [apps, setApps] = useState<DashboardApp[]>([]);
  const [store, setStore] = useState<StoreData | null>(null);
  const [manageApps, setManageApps] = useState(false);
  const [appName, setAppName] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [appError, setAppError] = useState('');
  const [storeBusyId, setStoreBusyId] = useState('');
  const wallpaperInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    let loadedUrl: string | null = null;
    void readWallpaper().then((image) => {
      if (!active || !image) return;
      loadedUrl = URL.createObjectURL(image);
      setWallpaperUrl(loadedUrl);
    }).catch(() => undefined);
    return () => { active = false; if (loadedUrl) URL.revokeObjectURL(loadedUrl); };
  }, []);
  useEffect(() => () => { if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl); }, [wallpaperUrl]);

  const refresh = useCallback(async () => {
    try { const next = await api<Metrics>('/api/metrics'); setMetrics(next); setLastUpdated(new Date()); }
    catch (error) { if (!(error instanceof Error && 'status' in error && error.status === 401)) setMessage({ text: 'System metrics could not be read.', tone: 'warning' }); }
  }, []);
  const refreshStore = useCallback(async () => {
    try { setStore(await api<StoreData>('/api/store')); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'The Store could not be loaded.', tone: 'warning' }); }
  }, []);

  useEffect(() => {
    let active = true;
    api<{ launchers: DashboardApp[] }>('/api/launchers').then(async ({ launchers }) => {
      let saved = launchers;
      const legacy = readLegacyApps();
      if (!launchers.length && legacy.length) {
        const migrated = await api<{ launchers: DashboardApp[] }>('/api/launchers', { method: 'PUT', body: JSON.stringify(legacy) });
        saved = migrated.launchers;
      }
      try { localStorage.removeItem('stanlab-app-launchers'); } catch { /* Storage may be unavailable. */ }
      if (active) setApps(saved);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    api<Capabilities>('/api/capabilities').then(setCapabilities).catch(() => undefined);
    void refresh();
    void refreshStore();
    const poll = window.setInterval(() => void refresh(), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(clock); };
  }, [refresh, refreshStore]);

  useEffect(() => {
    const syncTab = () => setActiveTab(tabFromHash());
    window.addEventListener('hashchange', syncTab);
    return () => window.removeEventListener('hashchange', syncTab);
  }, []);
  useEffect(() => { if (expiresAt && now >= expiresAt) onSignOut(); }, [expiresAt, now, onSignOut]);

  function selectTab(tab: DashboardTab) {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
  }
  async function saveApps(next: DashboardApp[]) {
    try {
      const result = await api<{ launchers: DashboardApp[] }>('/api/launchers', { method: 'PUT', body: JSON.stringify(next) });
      setApps(result.launchers);
      setMessage({ text: 'Apps saved on this server.', tone: 'success' });
      return true;
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Apps could not be saved.', tone: 'warning' });
      return false;
    }
  }
  async function addApp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAppError('');
    let parsed: URL;
    try { parsed = new URL(appUrl.trim()); } catch { setAppError('Enter a complete app address.'); return; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) { setAppError('Use an http:// or https:// address without embedded credentials.'); return; }
    if (!appName.trim()) { setAppError('Enter an app name.'); return; }
    const saved = await saveApps([...apps, { id: crypto.randomUUID(), name: appName.trim(), url: parsed.href }]);
    if (saved) { setAppName(''); setAppUrl(''); setManageApps(false); }
  }
  async function doAction(key: string, task: () => Promise<unknown>, success: string) {
    setBusyAction(key); setMessage(null);
    try { const result = await task(); setMessage({ text: success, tone: 'success' }); return result; }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'The action failed.', tone: 'warning' }); return null; }
    finally { setBusyAction(''); }
  }
  async function storeAction(id: string, action: 'install' | 'start' | 'stop' | 'restart' | 'update' | 'uninstall') {
    setStoreBusyId(id); setMessage(null);
    try {
      await api(`/api/store/apps/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      setMessage({ text: action === 'install' ? 'App installed on the Stanlab host.' : `${action[0].toUpperCase()}${action.slice(1)} completed.`, tone: 'success' });
      await refreshStore();
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'The Store action failed.', tone: 'warning' }); await refreshStore(); }
    finally { setStoreBusyId(''); }
  }
  async function chooseWallpaper(event: ChangeEvent<HTMLInputElement>) {
    const image = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!image) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(image.type)) { setMessage({ text: 'Choose a PNG, JPEG, WebP, or AVIF image.', tone: 'warning' }); return; }
    if (image.size > 15 * 1024 * 1024) { setMessage({ text: 'Wallpaper images must be 15 MB or smaller.', tone: 'warning' }); return; }
    try {
      const decoded = await createImageBitmap(image); const validDimensions = decoded.width <= 12000 && decoded.height <= 12000; decoded.close();
      if (!validDimensions) throw new Error('Wallpaper dimensions must be 12,000 pixels or smaller.');
      await saveWallpaper(image); setWallpaperUrl(URL.createObjectURL(image)); setMessage({ text: 'Wallpaper saved in this browser.', tone: 'success' });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Wallpaper could not be saved in browser storage.', tone: 'warning' }); }
  }
  async function clearWallpaper() {
    try { await saveWallpaper(null); setWallpaperUrl(null); setMessage({ text: 'Wallpaper cleared.', tone: 'success' }); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Wallpaper could not be cleared.', tone: 'warning' }); }
  }

  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  const title = activeTab === 'overview' ? 'Overview' : activeTab === 'applications' ? 'My Apps' : activeTab === 'store' ? 'App Store' : 'Scripts & controls';
  const subtitle = activeTab === 'overview' ? 'Your home server at a glance' : activeTab === 'applications' ? 'Services installed by Stanlab and your saved links' : activeTab === 'store' ? 'Curated apps installed on the server running Stanlab' : 'Manage the display session and run approved scripts';

  return <div className={`dashboard-shell min-h-screen ${wallpaperUrl ? 'has-wallpaper' : ''}`} style={wallpaperUrl ? { '--wallpaper-image': `url("${wallpaperUrl}")` } as CSSProperties : undefined}>
    <div className="grid min-h-screen w-full grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b border-[#292d32] bg-[#111315]/95 px-4 py-4 backdrop-blur-xl lg:flex lg:min-h-screen lg:flex-col lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
        <div className="flex items-center justify-between lg:block"><a href="#overview" onClick={(e) => { e.preventDefault(); selectTab('overview'); }} className="flex items-center gap-2.5 px-2 text-[17px] font-bold tracking-[-0.02em] text-zinc-100"><span className="grid size-8 place-items-center rounded-lg bg-lime-400/10 text-lime-300"><Activity size={19} /></span>Stanlab</a><span className="font-mono text-[11px] text-zinc-500 lg:hidden">{session.hostname}</span></div>
        <nav className="mt-5 flex gap-1 overflow-x-auto lg:mt-9 lg:flex-col" aria-label="Dashboard sections" role="tablist">
          {([['overview', 'Overview', Activity], ['applications', 'My Apps', AppWindow], ['store', 'App Store', Store], ['controls', 'Scripts & controls', Play]] as const).map(([tab, label, Icon]) => <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => selectTab(tab)} className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${activeTab === tab ? 'bg-lime-400/10 font-semibold text-lime-300' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}><Icon size={17} />{label}</button>)}
        </nav>
        <div className="mt-auto hidden border-t border-[#292d32] pt-5 lg:block"><div className="flex items-center gap-2.5 px-2"><span className="size-2 rounded-full bg-lime-400" /><span className="min-w-0 truncate text-sm font-medium text-zinc-200">{session.hostname}</span></div><p className="mt-1 pl-[18px] text-xs text-zinc-500">This server</p></div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-[68px] items-center justify-between gap-4 border-b border-[#292d32] bg-[#111315]/85 px-5 backdrop-blur-xl sm:px-7 lg:px-9">
          <div><h1 className="text-lg font-semibold tracking-[-0.025em] text-zinc-100">{title}</h1><p className="hidden text-xs text-zinc-500 sm:block">{subtitle}</p></div>
          <div className="flex items-center gap-2"><span className="hidden font-mono text-xs text-zinc-500 md:inline">{minutes} min session</span><input ref={wallpaperInput} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="sr-only" aria-label="Choose wallpaper image" onChange={chooseWallpaper} /><Button variant="ghost" onClick={() => wallpaperInput.current?.click()} className="min-h-9 px-2.5 text-xs" aria-label="Choose wallpaper"><ImagePlus size={15} /><span className="hidden sm:inline">{wallpaperUrl ? 'Change wallpaper' : 'Wallpaper'}</span></Button>{wallpaperUrl && <Button variant="ghost" onClick={() => void clearWallpaper()} className="min-h-9 px-2" aria-label="Clear wallpaper"><Trash2 size={15} /></Button>}<span className="mx-1 hidden h-6 w-px bg-[#343f46] sm:block" /><button onClick={onSignOut} className="grid size-9 place-items-center rounded-md text-zinc-400 transition hover:bg-white/5 hover:text-white" aria-label="Sign out"><LogOut size={17} /></button></div>
        </header>
        <main className="px-5 pb-10 pt-6 sm:px-7 sm:pt-7 lg:px-9">
          {activeTab === 'overview' && <section aria-label="System status" className="dashboard-panel">
            <div className="mb-3 flex items-center justify-between"><h2 className="dashboard-panel-title">System status</h2><Button variant="ghost" aria-label="Refresh system status" onClick={() => void refresh()} className="min-h-8 px-2 text-xs"><RefreshCw size={13} />Refresh</Button></div>
            <div className="grid grid-cols-2 md:grid-cols-4"><Metric icon={<Cpu size={15} />} label="CPU" percent={metrics?.cpu.percent ?? null} detail={metrics?.cpu.detail ?? 'Waiting for sample'} /><Metric icon={<Activity size={15} />} label="GPU" percent={metrics?.gpu.percent ?? null} detail={metrics?.gpu.usedBytes !== null && metrics?.gpu.usedBytes !== undefined && metrics.gpu.totalBytes !== null ? `${metrics.gpu.name ?? 'GPU'} · ${formatBytes(metrics.gpu.usedBytes)} / ${formatBytes(metrics.gpu.totalBytes)}` : metrics?.gpu.name ?? 'GPU telemetry unavailable'} /><Metric icon={<MemoryStick size={15} />} label="Memory" percent={metrics?.memory.percent ?? null} detail={metrics ? `${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}` : 'Waiting for sample'} /><Metric icon={<HardDrive size={15} />} label="Disk" percent={metrics?.disk.percent ?? null} detail={metrics ? `${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)} · ${metrics.disk.mount}` : 'Waiting for sample'} /></div>
            <div className="mt-3 flex items-center gap-2 border-t border-[#343940] pt-3 text-[11px] text-zinc-500"><span className="size-1.5 rounded-full bg-lime-400" />{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Collecting system data'}<span className="ml-auto hidden sm:inline">Refreshes every 5 seconds</span></div>
          </section>}

          {activeTab === 'applications' && <section className="dashboard-panel min-h-[calc(100vh-120px)]">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 className="dashboard-panel-title">My Apps</h2><p className="mt-1 text-sm text-zinc-500">Installed here, or linked from elsewhere on your network</p></div><Button variant="outline" onClick={() => { setManageApps(!manageApps); setAppError(''); }} className="min-h-10 px-3.5 text-xs"><Plus size={15} />{manageApps ? 'Cancel' : 'Add external app'}</Button></div>
            {manageApps && <form onSubmit={addApp} className="mb-5 grid gap-2 rounded-xl border border-[#343940] bg-[#141619]/90 p-4 sm:grid-cols-[minmax(130px,0.7fr)_minmax(220px,1.4fr)_auto] sm:items-start"><label className="sr-only" htmlFor="launcher-name">App name</label><Field id="launcher-name" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="App name" maxLength={48} required className="h-10" /><label className="sr-only" htmlFor="launcher-url">App address</label><Field id="launcher-url" type="url" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://service.example" maxLength={2048} required className="h-10" />{appError && <p role="alert" className="text-xs text-rose-300 sm:col-span-2">{appError}</p>}<Button type="submit" className="min-h-10 px-3 text-xs sm:col-start-3 sm:row-start-1"><Plus size={14} />Save app</Button></form>}
            {(() => {
              const installed = (store?.apps ?? []).filter((app) => app.installed).map((app) => ({ id: `store-${app.id}`, name: app.name, url: appAddress(app.port!) }));
              const allApps = [...installed, ...apps];
              return allApps.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{allApps.map((app) => <div key={app.id} className="group relative min-w-0">{manageApps && apps.some((item) => item.id === app.id) && <button onClick={() => void saveApps(apps.filter((item) => item.id !== app.id))} aria-label={`Remove ${app.name}`} className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-lg border border-white/10 bg-[#101214]/90 text-zinc-400 transition hover:border-rose-400/50 hover:text-rose-300"><Trash2 size={14} /></button>}<a href={app.url} target="_blank" rel="noopener noreferrer" className="dashboard-launcher flex min-h-[190px] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#222629]/95 to-[#141619]/95 p-4 shadow-lg shadow-black/10 transition duration-200 hover:-translate-y-1 hover:border-lime-300/60 hover:shadow-xl hover:shadow-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 sm:min-h-[220px] sm:p-5"><div className="flex items-start justify-between"><AppFavicon app={app} /><span className="grid size-9 place-items-center rounded-full border border-white/10 text-zinc-400 transition group-hover:border-lime-300/40 group-hover:text-lime-300"><ExternalLink size={15} /></span></div><div className="min-w-0"><h3 className="truncate text-base font-semibold text-zinc-100 sm:text-lg">{app.name}</h3><p className="mt-1 truncate font-mono text-[10px] text-zinc-500 sm:text-[11px]">{new URL(app.url).host}</p></div></a></div>)}</div> : <div className="grid min-h-[42vh] place-items-center rounded-2xl border border-dashed border-[#3a3f46] bg-[#141619]/45 px-5 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-lime-400/10 text-lime-300"><AppWindow size={24} /></span><h3 className="mt-4 text-base font-semibold text-zinc-200">No apps yet</h3><p className="mt-1 text-sm text-zinc-500">Install a service from the Store or add an external app link.</p><Button onClick={() => selectTab('store')} className="mt-4 min-h-10 px-4 text-xs"><Store size={15} />Open App Store</Button></div></div>;
            })()}
          </section>}

          {activeTab === 'store' && <StoreView store={store} busyId={storeBusyId} onAction={(id, action) => void storeAction(id, action)} onRefresh={() => void refreshStore()} />}

          {activeTab === 'controls' && <section className="dashboard-panel">
            <div className="mb-4"><h2 className="dashboard-panel-title">System controls</h2><p className="mt-1 text-sm text-zinc-500">Manage the display session and run approved scripts</p></div>
            <div className="grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
              <section className="dashboard-subpanel"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#3a3f46] text-zinc-300"><Tv size={17} /></span><div><h3 className="text-sm font-semibold text-zinc-100">Display manager</h3><p className="text-xs text-zinc-500">GNOME Display Manager</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!capabilities.displayManagerEnabled || !!busyAction} onClick={() => void doAction('gdm-start', () => api('/api/display-manager/start', { method: 'POST' }), 'GDM started.')} className="min-h-9 px-3 text-xs"><ArrowUpFromLine size={14} />{busyAction === 'gdm-start' ? 'Starting…' : 'Start GDM'}</Button><Button variant="outline" disabled={!capabilities.displayManagerEnabled || !!busyAction} onClick={() => void doAction('gdm-stop', () => api('/api/display-manager/stop', { method: 'POST' }), 'GDM stopped. The system returned to the TTY.')} className="min-h-9 px-3 text-xs"><ArrowDownToLine size={14} />{busyAction === 'gdm-stop' ? 'Stopping…' : 'Return to TTY'}</Button></div>{!capabilities.displayManagerEnabled && <p className="mt-3 text-[11px] leading-4 text-zinc-500">Enable the fixed GDM commands in the host configuration to use these controls.</p>}</section>
              <section className="dashboard-subpanel"><div className="mb-2 flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#3a3f46] text-zinc-300"><Play size={16} /></span><div><h3 className="text-sm font-semibold text-zinc-100">Quick scripts</h3><p className="text-xs text-zinc-500">Run your configured scripts</p></div></div>
                {capabilities.scripts.length ? <div className="divide-y divide-[#343940]">{capabilities.scripts.map((script) => <div key={script.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-2 last:pb-0"><div className="min-w-0"><div className="font-mono text-xs text-zinc-200">{script.label}</div>{!script.available && <span className="mt-1 block text-[11px] text-amber-300">Script file is missing</span>}</div><Button disabled={!script.available || !!busyAction} onClick={async () => { const result = await doAction(`script-${script.id}`, () => api<{ output: string }>('/api/scripts/run', { method: 'POST', body: JSON.stringify({ id: script.id }) }), `${script.label} finished.`) as { output: string } | null; if (result) setScriptOutput(result.output); }} className="min-h-8 px-3 text-xs"><Play size={13} fill="currentColor" />{busyAction === `script-${script.id}` ? 'Running…' : 'Run'}</Button></div>)}</div> : <p className="py-2 text-xs text-zinc-500">No scripts configured. Add a script under <code className="text-zinc-400">scripts/</code> and register it in <code className="text-zinc-400">config/scripts.json</code>.</p>}
                {scriptOutput && <pre className="mt-3 max-h-36 overflow-auto rounded-lg border border-[#343940] bg-[#101214] p-3 font-mono text-[11px] leading-4 text-zinc-300">{scriptOutput}</pre>}
              </section>
            </div>
          </section>}
          {message && <div role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-[#343940] bg-[#151719]/95 px-4 py-3"><span className="mt-0.5">{message.tone === 'warning' ? <CircleAlert size={16} className="text-amber-300" /> : <ShieldCheck size={16} className="text-lime-300" />}</span><Notice tone={message.tone}>{message.text}</Notice><button className="ml-auto px-2 text-sm text-zinc-500 hover:text-white" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div>}
        </main>
      </div>
    </div>
  </div>;
}

function StoreView({ store, busyId, onAction, onRefresh }: { store: StoreData | null; busyId: string; onAction: (id: string, action: StoreAction) => void; onRefresh: () => void }) {
  return <section className="dashboard-panel">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="dashboard-panel-title">App Store</h2><p className="mt-1 text-sm text-zinc-500">Install and manage curated services on this server</p></div><Button variant="ghost" onClick={onRefresh} className="min-h-8 px-2 text-xs"><RefreshCw size={14} />Refresh</Button></div>
    {store && <div className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${store.runtimeAvailable ? 'border-lime-400/20 bg-lime-400/5 text-zinc-300' : 'border-amber-400/20 bg-amber-400/5 text-amber-200'}`}><span className={`mt-1 size-1.5 shrink-0 rounded-full ${store.runtimeAvailable ? 'bg-lime-400' : 'bg-amber-300'}`} /><span>{store.runtimeAvailable ? `${store.runtime} is ready. Installs run on the machine hosting Stanlab.` : 'No Compose runtime detected on this server. Install Docker Compose v2 or Podman with a Compose provider, then restart Stanlab.'}</span></div>}
    <p className="mb-4 text-[11px] text-zinc-500">Store entries use fixed, reviewed definitions. Ports are selected by Stanlab; uninstalling keeps each app’s persistent data volume.</p>
    {store ? <div className="grid gap-3 xl:grid-cols-2">{store.apps.map((app) => <article key={app.id} className="dashboard-subpanel flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start"><span className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-lime-400/10 text-lime-300"><AppIcon name={app.name} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-zinc-100">{app.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${app.status === 'running' ? 'bg-lime-400/10 text-lime-300' : app.installed ? 'bg-zinc-500/15 text-zinc-300' : 'bg-zinc-500/10 text-zinc-500'}`}>{app.status}</span></div><p className="mt-1 text-xs text-zinc-500">{app.category}</p><p className="mt-3 text-sm leading-5 text-zinc-300">{app.description}</p><p className="mt-2 text-[11px] leading-4 text-zinc-500">{app.notes.join(' ')}</p>{app.installed && app.port && <p className="mt-2 font-mono text-[11px] text-zinc-400">Port {app.port}</p>}</div><div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{!app.installed ? <Button disabled={!store.runtimeAvailable || !!busyId} onClick={() => onAction(app.id, 'install')} className="min-h-9 px-3 text-xs"><Download size={14} />{busyId === app.id ? 'Installing…' : 'Install'}</Button> : <><Button variant="outline" disabled={!!busyId} onClick={() => onAction(app.id, app.status === 'running' ? 'stop' : 'start')} className="min-h-9 px-3 text-xs"><Play size={13} />{busyId === app.id ? 'Working…' : app.status === 'running' ? 'Stop' : 'Start'}</Button><Button variant="ghost" disabled={!!busyId} onClick={() => onAction(app.id, 'update')} className="min-h-9 px-2.5 text-xs"><RefreshCw size={13} />Update</Button><Button variant="ghost" disabled={!!busyId} onClick={() => onAction(app.id, 'uninstall')} className="min-h-9 px-2.5 text-xs text-rose-300"><Trash2 size={13} />Remove</Button></>}</div></article>)}</div> : <p className="py-10 text-center text-sm text-zinc-500">Loading Store…</p>}
  </section>;
}

function Metric({ icon, label, percent, detail }: { icon: React.ReactNode; label: string; percent: number | null; detail: string }) {
  const value = percent === null ? 'Unavailable' : `${percent}%`;
  return <div className="min-w-0 border-[#343940] px-2 py-2 first:pl-1 even:border-l even:pl-4 md:border-l md:pl-4 md:first:border-l-0 md:first:pl-1"><div className="flex items-center gap-2 text-xs font-semibold text-zinc-400"><span className="text-zinc-500">{icon}</span>{label}</div><div className="mt-2 truncate text-2xl font-semibold leading-none tracking-[-0.04em] text-zinc-100">{value}</div><div className="mt-2 min-h-4 truncate font-mono text-[10px] text-zinc-500">{detail}</div>{percent !== null && <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#2d3136]"><div className="h-full rounded-full bg-lime-400 transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}</div>;
}

function tabFromHash(): DashboardTab {
  const tab = window.location.hash.slice(1);
  return tab === 'applications' || tab === 'store' || tab === 'controls' ? tab : 'overview';
}

function readLegacyApps(): DashboardApp[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('stanlab-app-launchers') ?? '[]');
    return Array.isArray(value) ? value.filter((app): app is DashboardApp => {
      if (!app || typeof app.id !== 'string' || typeof app.name !== 'string' || typeof app.url !== 'string') return false;
      try { const url = new URL(app.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
    }) : [];
  } catch { return []; }
}

function appAddress(port: number) {
  const host = window.location.hostname || 'localhost';
  return `http://${host}:${port}`;
}

function AppIcon({ name }: { name: string }) {
  const value = name.toLowerCase();
  if (value.includes('jelly') || value.includes('plex') || value.includes('media')) return <Tv size={19} />;
  if (value.includes('home assistant') || value.includes('home')) return <House size={19} />;
  if (value.includes('immich') || value.includes('photo')) return <Images size={19} />;
  if (value.includes('adguard') || value.includes('pihole')) return <ShieldCheck size={19} />;
  if (value.includes('proxmox') || value.includes('server')) return <Server size={19} />;
  if (value.includes('uptime')) return <Activity size={19} />;
  return <AppWindow size={19} />;
}

function AppFavicon({ app }: { app: DashboardApp }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [app.url]);
  let favicon = '';
  try { favicon = `${new URL(app.url).origin}/favicon.ico`; } catch { setFailed(true); }
  return <span className="grid size-[68px] place-items-center overflow-hidden rounded-2xl border border-white/10 bg-[#101214]/75 text-lime-300 shadow-inner shadow-black/20">{!failed && favicon ? <img src={favicon} alt="" className="size-10 object-contain" onError={() => setFailed(true)} /> : <AppIcon name={app.name} />}</span>;
}
