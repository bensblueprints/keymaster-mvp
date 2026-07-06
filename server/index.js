const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 5328;
const app = createApp();

app.listen(PORT, () => {
  console.log('Keymaster license server running');
  console.log(`  Admin dashboard : http://localhost:${PORT}/admin`);
  console.log(`  Public v1 API   : http://localhost:${PORT}/api/v1/...`);
  console.log(`  Health          : http://localhost:${PORT}/api/health`);
});
