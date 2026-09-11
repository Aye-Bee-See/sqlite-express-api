import { sysPort } from '#constants';
import { createApp, ready } from './app.js';

const app = createApp();

// Listen right away so /health can answer 503 while the database is still
// being prepared, then report when the app is usable.
app.listen(sysPort, function () {
	console.log('Express is running on port: ' + sysPort);
});

ready.then(() => {
	console.log('Ready to serve requests.');
});
