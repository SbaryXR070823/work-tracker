// Entry point. React Native needs `AppRegistry.registerComponent('main', ...)` to be called
// before it can render anything; without it the app fails with
// "main host not been registered".
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
