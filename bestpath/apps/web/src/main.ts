import './styles/tokens.css';
import './styles/global.css';

import './config';
import './core/utils';
import './core/store';
import './core/api';
import './ui';
import './core/router';

// Screens register themselves with the router at import time, so they must be
// imported after core/router. This order is load-bearing, not cosmetic.
import './components/icons';
import './components';
import './screens/shared';
import './screens/welcome';
import './screens/passkey';
import './screens/recovery';
import './screens/home';
import './screens/activity';
import './screens/processing';
import './screens/receive';
import './screens/yield-detail';
import './screens/settings';
import './screens/contacts';
import './components/countries';
import './screens/onboarding';

import './flow';
import './actions';
import { boot } from './boot';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
