# NasZcan Meme Sim

Simulator **paper trading** memecoin Solana (pump.fun) dengan **uang virtual** dan **harga real-time**. Dibuat untuk latihan: mencoba strategi entry/exit tanpa risiko kehilangan uang sungguhan.

> ⚠️ Tidak ada koneksi wallet dan tidak ada pembelian sungguhan. Semua transaksi hanya simulasi. Bukan saran finansial — memecoin sangat berisiko.

**Demo:** https://sagaevans.github.io/Naszcan/

---

## Daftar isi
1. [Fitur](#fitur)
2. [Cara pakai](#cara-pakai)
3. [Cara kerja simulator](#cara-kerja-simulator)
4. [Cara kerja Scanner koin KOL](#cara-kerja-scanner-koin-kol)
5. [Install & jalankan di PC sendiri](#install--jalankan-di-pc-sendiri)
6. [Fork & jalankan scanner otomatis milikmu sendiri](#fork--jalankan-scanner-otomatis-milikmu-sendiri)
7. [Struktur file](#struktur-file)
8. [Batasan](#batasan)
9. [Kontribusi](#kontribusi)

---

## Fitur
- **Saldo virtual $100** (bisa diubah), mulai kosong tanpa posisi.
- **Beli/jual** token Solana dengan memasukkan contract address (CA) atau mencari nama/simbol.
- **Fee & slippage simulasi** (default 1% + 1%, bisa diatur) supaya hasil mendekati kondisi nyata.
- **Harga real-time** dari DexScreener, diperbarui otomatis tiap ±15 detik.
- **Grafik**: embed DexScreener, atau grafik candle sendiri (GeckoTerminal) dengan timeframe 1m / 5m / 15m / 1j / 4j.
- **Posisi terbuka, P/L, riwayat transaksi, watchlist.**
- **Simpan otomatis** di browser (localStorage) + **Ekspor/Impor** data dalam bentuk teks.
- **Scanner koin KOL**: daftar koin pump.fun yang baru dibeli wallet top leaderboard Kolscan dalam **1 jam terakhir** (bisa 30 menit/2 jam), dipindai langsung di browser saat tombol ditekan.

## Cara pakai
1. Buka demo atau jalankan di PC (lihat bawah).
2. Tempel CA token (contoh berakhiran `...pump`) atau ketik nama koin di kolom pencarian.
3. Isi jumlah USD → **Beli**. Untuk keluar, isi persentase → **Jual**.
4. Pantau P/L di bagian **Posisi**. Semua tersimpan otomatis di browser yang sama.
5. Di bagian **Scanner**, tekan **Scan koin** → atur filter → tekan **Muat** untuk membuka koin itu di simulator.
6. Pindah perangkat? Pakai **Ekspor** lalu **Impor** di perangkat lain.

## Cara kerja simulator
Semua berjalan **100% di browser** (HTML + CSS + JavaScript murni, tanpa server, tanpa build step).

| Bagian | Sumber / cara |
|---|---|
| Harga, market cap, likuiditas, volume, % perubahan | DexScreener API `https://api.dexscreener.com/tokens/v1/solana/{CA}` (maks. 30 CA per permintaan) |
| Pencarian koin | `https://api.dexscreener.com/latest/dex/search?q={query}` |
| Harga SOL | DexScreener, pair SOL/USDC atau SOL/USDT |
| Token yang belum punya pair (masih bonding curve pump.fun) | Fallback: baca transaksi terakhir via Solana RPC publik (`solana-rpc.publicnode.com`) |
| Grafik candle | GeckoTerminal API (pool token → OHLCV) + library `lightweight-charts` |
| Penyimpanan | `localStorage` key `naszcan-sim-v1` |

**Rumus transaksi simulasi**
- **Beli** $U: fee = U × fee%; harga eksekusi = harga pasar × (1 + slippage%); token diterima = (U − fee) ÷ harga eksekusi.
- **Jual** N token: harga eksekusi = harga pasar × (1 − slippage%); hasil kotor = N × harga eksekusi; diterima = hasil kotor − fee.
- **P/L** = nilai posisi saat ini − modal yang dikeluarkan.

Jika API membalas `429 Too Many Requests`, app otomatis memperlambat refresh ke 30 detik lalu mencoba lagi.

## Cara kerja Scanner koin KOL
Scanner berjalan **langsung di browser saat tombol "Scan koin" ditekan** (jendela bisa diatur 0,25–6 jam, default 2 jam). Kolscan tidak mengizinkan akses dari browser (CORS), jadi daftar wallet disiapkan GitHub Actions di `data/wallets.json`.

```
GitHub Actions (2x sehari, 00.05 & 12.05 UTC = 07.05 & 19.05 WIB)
  └─ WALLETS_ONLY=1 node scanner/scan.mjs
       Ambil 50 wallet top dari https://kolscan.io/leaderboard → data/wallets.json → commit

App (tombol "Scan koin", bisa dihentikan dengan "Berhenti")
  1. Baca data/wallets.json
  2. Tiap wallet: signature transaksi dalam jendela waktu (getSignaturesForAddress, RPC publik)
  3. Detail tiap transaksi (getTransaction, 12 paralel) → perubahan SOL & token milik wallet
  4. Swap sederhana SOL → 1 token = BELI, token → SOL = JUAL
  5. Kelompokkan per token berakhiran "pump": jumlah wallet pembeli, SOL dibeli,
     wallet yang masih memegang ≥50% pembeliannya
  6. Waktu launching koin = pairCreatedAt paling awal di DexScreener (pair bonding curve pump.fun)
  7. Filter yang bisa diatur user:
     - Maks. wallet, default 50: berapa wallet teratas leaderboard yang dipindai (lebih sedikit = lebih cepat)
     - Dibeli dalam (jam), default 2: jendela transaksi KOL yang dipindai
     - Umur koin maks. (jam), default 24
     - Min. SOL dibeli KOL, default 2 (total semua wallet KOL dalam jendela)
     - Masih dipegang KOL (default aktif), min. wallet KOL, maks. market cap
  8. Harga, market cap, % 1 jam dari DexScreener → tampilkan dengan filter
  Jika RPC gagal, app memuat hasil terakhir data/scan.json sebagai cadangan.
```

Scan 2 jam untuk 50 wallet biasanya 2–6 menit (banyak wallet menerima transaksi spam/airdrop yang ikut terbaca).

Scan penuh lewat Actions masih tersedia: **Actions → Scan koin KOL → Run workflow → centang "Scan penuh"** (hasil ke `data/scan.json`).

**Skor** (untuk urutan, bukan rekomendasi):
`skor = wallet_pembeli × 10 + wallet_masih_pegang × 8 + log10(1 + SOL_dibeli) × 12 − penalti kenaikan 24 jam`

**Filter di app**: minimal jumlah wallet KOL, maksimal market cap, dan hanya koin yang masih dipegang KOL (default aktif: minimal 1 wallet masih memegang ≥50% pembeliannya).

**Kenapa hasil bisa berbeda dari Kolscan?** Scanner hanya menghitung swap sederhana SOL↔token; transaksi rumit (multi-token, transfer, bridge) dilewati. Jumlah transaksi per wallet juga dibatasi (`MAX_TX_PER_WALLET`).

Detail singkat ada juga di [`SCANNER.md`](SCANNER.md).

## Install & jalankan di PC sendiri

### Yang dibutuhkan
- **Git** — https://git-scm.com/downloads
- Salah satu: **Python 3** (https://www.python.org/downloads/) **atau** **Node.js 18+** (https://nodejs.org/) untuk server lokal
- Node.js 18+ juga diperlukan jika ingin menjalankan scanner sendiri
- Browser modern (Chrome, Edge, Firefox, Safari)

### 1. Unduh kode
```bash
git clone https://github.com/sagaevans/Naszcan.git
cd Naszcan
```
Tanpa Git: tombol hijau **Code → Download ZIP** di GitHub, lalu ekstrak.

### 2. Jalankan server lokal
Jangan membuka `index.html` dengan klik dua kali (`file://`), karena browser memblokir sebagian permintaan data. Jalankan server lokal:

```bash
# Pilihan A — Python
python -m http.server 8080        # Windows
python3 -m http.server 8080       # macOS / Linux

# Pilihan B — Node.js
npx serve -l 8080 .
```
Buka **http://localhost:8080** di browser. Selesai — simulator langsung jalan dengan data real-time.

### 3. (Opsional) Jalankan scanner di PC
```bash
node scanner/scan.mjs
```
Hasilnya ditulis ke `data/scan.json`, lalu tombol **Scan koin** di app lokal akan membacanya. Pengaturan lewat environment variable:

| Variabel | Default | Fungsi |
|---|---|---|
| `HOURS` | `2` (Actions: `1`) | Jendela waktu transaksi (jam) |
| `MAX_WALLETS` | `100` | Maksimal wallet dari leaderboard (Kolscan publik = 50) |
| `MAX_TX_PER_WALLET` | `500` | Batas transaksi dibaca per wallet |
| `CONCURRENCY` | `8` | Jumlah permintaan RPC paralel |
| `WALLETS_ONLY` | kosong | `1` = hanya perbarui `data/wallets.json` |
| `RPC_URL` | publicnode | RPC Solana (disarankan RPC pribadi, mis. Helius gratis) |
| `OUT` | `data/scan.json` | Lokasi file hasil |

Contoh:
```bash
# macOS / Linux
HOURS=1 MAX_WALLETS=20 node scanner/scan.mjs

# Windows PowerShell
$env:HOURS=1; $env:MAX_WALLETS=20; node scanner/scan.mjs
```
Tanpa menjalankan scanner, app lokal otomatis mengambil hasil scan terbaru dari repo ini (`raw.githubusercontent.com`).

## Fork & jalankan scanner otomatis milikmu sendiri
1. Klik **Fork** di GitHub.
2. Di fork-mu: **Settings → Pages → Branch `main` / root → Save**. App akan tersedia di `https://<username>.github.io/Naszcan/`.
3. **Settings → Actions → General → Workflow permissions → Read and write permissions** (agar Actions bisa commit `data/scan.json`).
4. Tab **Actions** → aktifkan workflow → pilih **Scan koin KOL** → **Run workflow** untuk membuat `data/wallets.json` pertama.
5. (Disarankan) **Settings → Secrets and variables → Actions → New repository secret**: nama `RPC_URL`, isi URL RPC pribadimu. RPC publik sering membatasi permintaan.
6. Ganti URL cadangan di `app.js` (`SCAN_URLS` dan `WALLET_URLS`) dari `sagaevans/Naszcan` ke `<username>/Naszcan`.

**Mengatur / menghentikan scan otomatis**
- Ubah jadwal: edit `cron` di `.github/workflows/scan.yml` (format UTC; `5 0,12 * * *` = 2x sehari).
- Hentikan scan yang sedang berjalan: **Actions → pilih run → Cancel run**.
- Matikan jadwal: **Actions → Scan koin KOL → ⋯ → Disable workflow**.

## Struktur file
```
index.html                  Halaman utama
style.css                   Tampilan
hark.js                     Komponen UI (navigasi, dll.)
app.js                      Logika simulator, harga, grafik, scanner
scanner/scan.mjs            Skrip pemindai wallet KOL (Node.js)
.github/workflows/scan.yml  Jadwal GitHub Actions untuk scanner
data/wallets.json           Daftar wallet KOL untuk scan di browser (dibuat Actions)
data/scan.json              Hasil scan penuh Actions (cadangan)
SCANNER.md                  Ringkasan scanner
.nojekyll                   Agar GitHub Pages menyajikan file apa adanya
```

## Batasan
- Data disimpan per browser. Hapus data browser = data simulasi hilang (gunakan Ekspor).
- Harga simulasi tidak memperhitungkan dampak harga (price impact) dari order besar.
- API gratis (DexScreener, GeckoTerminal, RPC publik) bisa lambat atau membatasi permintaan.
- Scanner bergantung pada struktur halaman Kolscan; jika Kolscan berubah, scanner perlu disesuaikan.
- Hasil scanner hanya informasi untuk latihan, bukan sinyal beli.

## Kontribusi
Issue dan pull request dipersilakan. Ide pengembangan: sumber leaderboard lain, deteksi rug, notifikasi, statistik win-rate simulasi.

---
Dibuat untuk belajar. Gunakan dengan bijak. 🚀
