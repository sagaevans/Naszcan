# Scanner koin KOL

- `scanner/scan.mjs` membaca wallet top leaderboard Kolscan (halaman publik menampilkan 50), transaksi 2 jam terakhir via Solana RPC, menjumlahkan SOL yang dibelanjakan per token `...pump`, lalu menambahkan data DexScreener. Hasil: `data/scan.json`.
- `.github/workflows/scan.yml` menjalankannya tiap jam dan meng-commit `data/scan.json`. Bisa juga dijalankan manual: tab Actions → "Scan koin KOL" → Run workflow.
- Opsional: tambahkan secret `RPC_URL` (mis. Helius gratis) di Settings → Secrets → Actions agar lebih cepat. Tanpa itu memakai publicnode (lebih lambat).
- Tombol "Scan koin" di app membaca `data/scan.json` lalu mengecek harga live di DexScreener. Hanya informasi; semua trading tetap virtual.
