import { BP } from './bp';

/* ---- store ---- */
export const DEFAULT_STATE = {
  version: BP.config.version,
  onboardingComplete: false,
  session: true,
  userName: 'Ana',
  firstName: 'Ana',
  lastName: '',
  bpTag: '@ana',
  recoveryEmail: '',
  recoveryPhone: '',
  recoveryPhoneCountry: 'AR',
  balance: 0,
  position: null,
  positionStatus: 'unknown',
  walletAddress: '',
  hasReceivedFunds: false,
  movements: [],
  contacts: [
    { id:'c1', name:'Carlos Méndez', tag:'@carlos', initials:'CM', color:'#FF4D5A' },
    { id:'c2', name:'María López',   tag:'@maria',  initials:'ML', color:'#1DB981' },
    { id:'c3', name:'Julián Ruiz',   tag:'@julian', initials:'JR', color:'#FFC857' },
    { id:'c4', name:'Sofía Chen',    tag:'@sofia',  initials:'SC', color:'#2E7DFF' }
  ],
  settings: { biometricEnabled: true, notificationsEnabled: true },
  yieldStartedAt: null,
  createdAt: Date.now(),
  lastYieldAt: Date.now()
};

// Order in which versions chain forward. Each key is the version being migrated
// FROM; the value is the version it becomes.
const BP_CONFIG_ORDER: Record<string, string> = { '0.2': '0.3', '0.3': '0.4', '0.4': '0.5', '0.5': '0.6' };

export const Store = BP.store = {
  _state: null,
  _listeners: new Set(),
  load(){
    try {
      const raw = localStorage.getItem(BP.config.storageKey);
      if (raw){
        const parsed = JSON.parse(raw);
        // Chain every historical version forward to the current one. Each step
        // only fills fields that did not exist yet; anything already present in
        // the saved state wins, so re-running a migration is harmless.
        const MIGRATIONS: Record<string, (raw: any) => any> = {
          '0.2': (raw) => ({ ...raw, session: true, settings: {} }),
          '0.3': (raw) => raw,
          // design-system-v2: the avatar palette changed. Existing contacts keep a
      // stored colour, so without this they would keep the OLD purple/green
      // forever while every new avatar used the new one.
      '0.5': (raw) => {
        const remap = {
          '#5B4DFF': '#2E7DFF', '#FF6B5B': '#FF4D5A', '#34C759': '#1DB981',
          '#FFB020': '#FFC857', '#41B5FF': '#3D8BFF', '#A56BFF': '#35C994',
        };
        const paint = (c) => remap[String(c || '').toUpperCase()] ?? c;
        return {
          ...raw,
          contacts: (raw.contacts || []).map((c) => ({ ...c, color: paint(c.color) })),
        };
      },
      '0.4': (raw) => ({
            ...raw,
            // v0.5 split the profile: userName was a single field.
            firstName: raw.firstName ?? raw.userName ?? '',
            lastName: raw.lastName ?? '',
            recoveryPhoneCountry: raw.recoveryPhoneCountry ?? 'AR',
            // A user who already had movements has, by definition, received
            // funds — do not re-onboard them by resetting the flag to false.
            hasReceivedFunds: raw.hasReceivedFunds ?? (raw.movements?.length ?? 0) > 0,
          }),
        };

        if (parsed && typeof parsed.version === 'string'){
          let next = parsed;
          while (next.version !== BP.config.version){
            const step = MIGRATIONS[next.version];
            if (!step) break;                       // unknown version: fall through to defaults
            next = { ...step(next), version: BP_CONFIG_ORDER[next.version] };
          }
          this._state = Object.assign({}, DEFAULT_STATE, next, {
            settings: Object.assign({}, DEFAULT_STATE.settings, parsed.settings || {}),
          });
          if (this._state.version !== parsed.version) this.save();
          return this._state;
        }
      }
    } catch(e){ console.warn('[BP] No se pudo leer el estado guardado.', e); }
    this._state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    return this._state;
  },
  save(){ try { localStorage.setItem(BP.config.storageKey, JSON.stringify(this._state)); } catch(e){ console.warn('[BP] save falló', e); } },
  get(){ return this._state; },
  set(patch){ Object.assign(this._state, patch); this.save(); this._emit(); },
  setSetting(key, value){ this._state.settings[key] = value; this.save(); this._emit(); },
  reset(){ try { localStorage.removeItem(BP.config.storageKey); }catch(e){} this._state = JSON.parse(JSON.stringify(DEFAULT_STATE)); this.save(); this._emit(); },
  subscribe(fn){ this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _emit(){ this._listeners.forEach(fn => { try{ fn(this._state); }catch(e){ console.error(e); } }); }
};

