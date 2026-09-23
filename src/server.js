import app from './app.js';
import config from './config.js';
import { getDb } from '../db/index.js';

async function bootstrap() {
  try {
    // Inisialisasi Database
    await getDb();

    app.listen(config.port, () => {
      console.log('========================================================');
      console.log(`🚀 ${config.officeName} - SERVER RUNNING`);
      console.log(`🌐 Server URL       : http://localhost:${config.port}`);
      console.log(`📺 Display Monitor  : http://localhost:${config.port}/display`);
      console.log(`📱 Web QR Scanner   : http://localhost:${config.port}/scan`);
      console.log(`🔐 Halaman Login    : http://localhost:${config.port}/login`);
      console.log(`📊 Dashboard Admin  : http://localhost:${config.port}/admin`);
      console.log('========================================================');
    });
  } catch (err) {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  }
}

bootstrap();
