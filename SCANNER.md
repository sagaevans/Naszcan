# Scanner koin KOL

- `scanner/scan.mjs` membaca wallet top leaderboard Kolscan (halaman publik menampilkan 50), transaksi 12 jam terakhir via Solana RPC, menjumlahkan SOL yang dibelanjakan per token `...pump`, lalu menambahkan data DexScreener. Hasil: `data/scan.json`.
- `.github/workflows/scan.yml` menjalankannya tiap 3 jam dan meng-commit `data/scan.json`. Bisa juga dijalankan manual: tab Actions → "Scan koin KOL" → Run workflow.
- Opsional: tambahkan secret `RPC_URL` (mis. Helius gratis) di Settings → Secrets → Actions agar lebih cepat. Tanpa itu memakai publicnode (lebih lambat, ~20–40 menit).
- Tombol "Scan koin" di app membaca `data/scan.json` lalu mengecek harga live di DexScreener. Hanya informasi; semua trading tetap virtual.
