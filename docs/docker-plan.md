# Rencana: seo-audit jadi web UI dalam container

Menyusutkan repo ini jadi satu front end — halaman yang sudah disajikan
`--serve` — lalu mengemasnya sebagai image yang dibangun otomatis saat tag
versi didorong. Polanya mengikuti `chess-js`: `docker-compose.yml` di akar,
`release.yml` yang dipicu tag dan mendorong ke GHCR, verifikasi dipanggil ulang
sebagai reusable workflow sebelum apa pun diterbitkan.

Keputusan yang sudah dikunci:

| | |
|---|---|
| Cakupan hapus | Semua front end selain web: `mac/`, `desktop/`, `raycast/` |
| Ekspos | Loopback saja — `127.0.0.1:4321` di host |
| Rilis | Hanya push image ke GHCR; tidak ada GitHub Release |

---

## Temuan yang mengubah rencana

Tiga hal yang ditemukan saat membaca kode, dan masing-masing mengubah bentuk
pekerjaan. Ini bagian terpenting dari dokumen ini.

**1. `--serve` bind ke `127.0.0.1` dan tidak ada flag untuk mengubahnya.**
[src/serve.mjs:29](../src/serve.mjs#L29) menerima parameter `host`, tapi
[bin/seo-audit.mjs:365](../bin/seo-audit.mjs#L365) hanya meneruskan `port`,
`maxPages` dan `userAgent`. Di dalam container, bind ke loopback berarti port
yang dipublish tidak menjawab apa pun. **Tanpa flag `--host` baru, containernya
tidak bisa dipakai sama sekali.** Ini prasyarat, bukan penyempurnaan.

**2. Server lokal itu memang tanpa autentikasi, secara sengaja.**
`serve()` membuat `AUDIT_TOKEN` acak setiap start lalu menyuntikkannya ke
*setiap* request yang masuk, jadi `authorized()` selalu lolos. Komentar di
[src/serve.mjs:40-57](../src/serve.mjs#L40-L57) menjelaskan alasannya panjang
lebar: `ALLOW_PSI`, `ALLOW_SEARCH_CONSOLE` dan `ALLOW_HOSTS` dinyalakan **karena**
servernya terikat loopback — orang yang menjalankannya adalah orang yang
dilayaninya. Worker yang di-deploy sengaja membiarkan semuanya kosong, dan
menolak jalan tanpa `AUDIT_TOKEN` ([worker/index.mjs:793](../worker/index.mjs#L793)).

Artinya: mempublish port ini ke jaringan persis hal yang penulisnya hindari.
Yang membuat rencana ini aman bukan flag `--host 0.0.0.0` di dalam container,
melainkan `ports: ['127.0.0.1:4321:4321']` di compose. **Kalau suatu saat itu
diubah jadi `0.0.0.0`, `serve()` harus diubah lebih dulu** supaya token datang
dari env dan `ALLOW_*` jadi opt-in. Catat ini di README, jangan hanya di sini.

**3. `mac/` dan `desktop/` hanyalah webview di sekitar `--serve`.** Keduanya
menjalankan `bin/seo-audit.mjs --serve 0`, membaca port dari stdout, lalu
mengarahkan webview ke sana. Konsekuensinya menyenangkan: **kontrak `app:` di
[src/options.mjs](../src/options.mjs) tidak perlu dibuang.** "Window" tinggal
berarti halaman yang disajikan, bukan shell native. Yang mati hanya *test* yang
memverifikasinya terhadap `CrawlSettings.swift` — dan ada pengganti yang setara
dan tidak sirkular (lihat Fase 2).

---

## Fase 1 — Hapus front end non-web

```
mac/                      424K
desktop/                  1.7M
raycast/                  6.9M
Casks/seo-audit.rb        cask Homebrew untuk app yang sudah tidak ada
Package.swift             manifest SwiftPM
scripts/link-engine.mjs   hanya untuk raycast
scripts/test-all.mjs      hanya menjalankan swift + cargo
test/raycast.test.mjs     730 baris, 47 test
.github/workflows/npm-publish.yml
.github/workflows/mac-release.yml
.github/workflows/mac-app.yml
.github/workflows/desktop.yml
```

`package.json`: buang `pretest`, `pretest:all` dan `test:all`. Efek sampingnya
bagus — `pretest` inilah yang membuat `npm test` gagal `EPERM` di Windows tanpa
Developer Mode.

`.gitignore`: buang blok `.build/`, `desktop/src-tauri/target/`,
`desktop/src-tauri/gen/`, `binaries/`, `engine/`.

**Yang tetap tinggal:** `action.yml` (GitHub Action itu CLI di CI, bukan front
end tersendiri, dan `self-check.yml` memakainya), `worker/`, `bin/`, `src/`,
`test/` selebihnya, `docs/`.

**Yang perlu diputuskan nanti:** blok `exports` di `package.json` ada untuk
raycast. Worker mengimpor lewat path relatif, jadi blok itu jadi tidak terpakai
— tapi membuangnya memutus siapa pun yang mengimpor `@nurkamol/seo-audit/score`.
Biarkan saja; tidak ada ruginya.

---

## Fase 2 — Rapikan kontrak yang tersisa

### `test/options.test.mjs` — 13 test jadi 7

| Test | Nasib |
|---|---|
| `every flag the command line parses has an answer about the window` | **Simpan**, ganti kata "window" jadi "halaman yang disajikan" di pesan errornya |
| `the table does not describe flags that no longer exist` | Simpan apa adanya |
| `a flag the table says the window sends, the window sends` | **Tulis ulang** — lihat di bawah |
| `a parameter the window sends is one the table knows about` | **Tulis ulang** — lihat di bawah |
| `the app's own test knows which parameters every run sends` | Hapus (`ModelTests.swift`) |
| `every file that carries the version agrees about it` | **Susutkan** jadi hanya memeriksa `package.json` semver; tiga file lain sudah tidak ada |
| `the winget identifier the workflow publishes…` | Hapus |
| `a CHANGELOG version says Added or Fixed once, not twice` | Simpan |
| `every reason is a sentence somebody can act on` | Simpan — ini tetap berlaku |
| `nothing is declared twice` | Simpan |
| `no source file is a binary file to git` | Simpan |
| `the app is built from the four named radii…` | Hapus (`mac/*.swift`) |
| `every settings text field looks like one` | Hapus (`SettingsScene.swift`) |

Dua yang ditulis ulang adalah bagian yang penting. Test lama membandingkan tabel
dengan `CrawlSettings.swift` dua arah. Penggantinya membandingkannya dengan
**`worker/index.mjs`**, yang membaca parameter secara harfiah sebagai
`url.searchParams.get('<nama>')` di handler `/stream`
([worker/index.mjs:1325](../worker/index.mjs#L1325) dan seterusnya):

```js
/** Setiap nama parameter yang dibaca worker, siapa pun penerimanya.
 *
 *  `.get(` tanpa `searchParams.` di depannya, dan itu disengaja: separuh
 *  parameter run dibaca di dalam helper — psiOptions(), hostOptions(),
 *  searchConsoleProperty(), agentFor() — yang menerima searchParams dengan
 *  nama lain. Mencocokkan `searchParams.get(` saja melewatkan delapan dari
 *  enam belas dan melaporkannya sebagai rusak. (Sudah diverifikasi.) */
const workerParameters = () =>
  new Set([...read('worker/index.mjs').matchAll(/\.get\('([a-zA-Z-]+)'\)/g)].map((m) => m[1]));

test('a flag the table says the page sends, the worker reads', () => {
  const seen = workerParameters();
  const broken = runParameters().filter((o) => !seen.has(o.query));
  assert.deepEqual(broken.map((o) => o.flag), [],
    `src/options.mjs says the page sends ${broken.map((o) => o.query).join(', ')} and ` +
    'the worker never reads it. Wire it up, or change the entry to say why it does not.');
});
```

Arah maju ini **sudah diuji terhadap kode sekarang dan lolos bersih** — 16
parameter run, semuanya terbaca.

Arah sebaliknya butuh daftar pengecualian, dan sebaiknya jujur soal itu:
`.get()` yang sama juga membaca header dan parameter endpoint lain — `cookie`,
`authorization`, `token`, `url`, `since`, `sort`, `dir`, `as`, `format`.
Sembilan nama itu dimasukkan sebagai konstanta dengan komentar yang menyebut
milik siapa masing-masing, lalu sisanya wajib ada di tabel. Itu tetap menangkap
kegagalan yang dulu paling parah — **parameter yang dikirim halaman dan tidak
ada flag-nya, alias setelan yang diam-diam tidak melakukan apa-apa.**

Sirkularitas terhindar karena `formFields()` dibangun *dari* tabel, jadi
membandingkan keduanya tidak membuktikan apa pun, sementara `worker/index.mjs`
ditulis terpisah dengan tangan.

### `test/workflows.test.mjs` — 5 test jadi 5

Satu perlu diperbaiki: `a warning that points somewhere points somewhere real`
meng-hardcode `assert.ok(desktop, 'desktop.yml should be there')`
([test/workflows.test.mjs:26](../test/workflows.test.mjs#L26)). Ubah jadi
mengiterasi semua workflow, bukan mencari satu nama. Itu justru membuatnya lebih
kuat daripada sekarang.

Sisanya lolos apa adanya — dan satu di antaranya **membatasi rancangan Fase 5**:

> `a tag trigger names version tags, never a bare v*`

`chess-js` memakai `tags: ['v*']`. Repo ini melarangnya, karena `v1` mengambang
dan `v*` cocok dengannya, sehingga setiap rilis kompatibel memicu build kedua
untuk rilis yang tidak ada. **`release.yml` harus memakai
`'v[0-9]+.[0-9]+.[0-9]+'`.** Test-nya akan gagal kalau pola chess-js disalin
mentah-mentah.

Setelah penghapusan tersisa tiga workflow — `test.yml`, `self-check.yml`,
`release.yml` — jadi `assert.ok(workflows.length >= 3)` masih lolos, pas.

### `src/options.mjs`

Tidak ada perubahan struktural. Perbarui komentar kepala berkas dan kalimat
`app:` yang menyebut "the macOS window" jadi "the served page". Entri seperti

```js
{ flag: '--serve', query: null, app: 'the window is what --serve serves' },
```

tetap benar dan tidak perlu disentuh.

---

## Fase 3 — Flag `--host`

Ikuti aturan repo, dengan satu pengecualian yang sudah ada presedennya.

**1. [bin/seo-audit.mjs](../bin/seo-audit.mjs)** — parse dan teruskan:

```js
else if (arg === '--host') opts.host = argv[++i];
```

```js
const { url } = await serve({
  port: opts.serve === true ? 4321 : opts.serve,
  host: opts.host,          // serve() sudah default ke 127.0.0.1
  maxPages: opts.limit,
  userAgent: opts.userAgent,
});
```

Perhatikan: `host: undefined` **tidak** akan memakai default parameter kalau
ditulis sebagai `host: opts.host ?? '127.0.0.1'` di dua tempat. Serahkan saja ke
default `serve()`; `{ host: undefined }` memang memicu default parameter di
JavaScript, jadi ini aman.

Teks bantuan, di bawah `--serve`:

```
    --host <address>   the address --serve binds to (default 127.0.0.1).
                       0.0.0.0 is for a container, where the loopback
                       address answers nothing from outside it — and the
                       thing that keeps that safe is what publishes the
                       port, not this flag
```

**2. `action.yml` — dilewati, dan itu bukan kelalaian.** `--serve` dan
`--no-open` juga tidak ada di sana: action menjalankan crawl lalu keluar, jadi
flag khusus server tidak punya arti di dalamnya. Aturan "tiga tempat" di
CLAUDE.md perlu mencatat pengecualian ini secara eksplisit.

**3. [src/options.mjs](../src/options.mjs)** — di blok "deliberately not in a
window", bersebelahan dengan `--serve`:

```js
{ flag: '--host', query: null, app: 'the page cannot move the socket it is being served over' },
```

---

## Fase 4 — Berkas Docker

### `Dockerfile`

```dockerfile
# Tidak ada dependensi, jadi tidak ada `npm ci` dan tidak ada tahap build:
# image ini adalah sebuah Node dan pohon sumbernya, tidak lebih.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# package.json ikut hanya supaya `--version` dan endpoint /options punya
# sesuatu untuk dibaca.
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY worker ./worker

# Run yang tersimpan. `libraryRoot()` menghormati SEO_AUDIT_HOME sebelum apa
# pun yang lain, jadi ini titik mount volumenya — jauh lebih rapi daripada
# menebak-nebak direktori home di dalam container.
ENV SEO_AUDIT_HOME=/data
RUN mkdir -p /data && chown node:node /data
USER node

ENV PORT=4321
EXPOSE 4321

# Alpine tidak punya curl; Node 22 sudah punya fetch global. /options murah dan
# selalu terautentikasi, karena serve() menyuntikkan tokennya sendiri.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/options').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# --host 0.0.0.0 tidak opsional di dalam container: serve() default ke
# 127.0.0.1, yang dari luar container tidak menjawab apa pun. Yang menjaga ini
# tetap aman adalah compose, yang mempublishnya hanya ke loopback host.
CMD ["sh", "-c", "node bin/seo-audit.mjs --serve ${PORT} --host 0.0.0.0 --no-open"]
```

### `.dockerignore`

```
.git
.github
node_modules
**/node_modules
test
docs
scripts
action.yml
Dockerfile
.dockerignore
docker-compose.yml
*.md
.gitignore
.gitattributes
reports/
.wrangler/
```

### `docker-compose.yml`

```yaml
# Menjalankan web UI-nya:
#
#   docker compose up --build      lalu buka http://localhost:4321
#
# Hanya satu layanan: yang disajikan `--serve` adalah worker/index.mjs yang
# sama persis dengan yang berjalan di Cloudflare, lewat adapter node:http
# setebal tiga puluh baris. Tidak ada klien terpisah untuk dibangun.

services:
  web:
    build:
      context: .
    image: ghcr.io/nurkamol/seo-audit:local
    # Terikat ke loopback host, dan itu bukan kehati-hatian berlebihan.
    # `serve()` menyuntikkan token autentikasinya sendiri ke setiap request,
    # jadi siapa pun yang bisa menjangkau port ini mendapat crawler tanpa
    # kata sandi — lengkap dengan kuota PageSpeed dan kredensial Search
    # Console milik siapa pun yang menjalankannya. Membukanya ke 0.0.0.0
    # butuh perubahan pada serve.mjs lebih dulu, bukan hanya di baris ini.
    ports:
      - '127.0.0.1:${PORT:-4321}:4321'
    environment:
      # Run yang selesai disimpan di sini. Tanpa volume, crawl tujuh menit
      # hilang bersama containernya.
      SEO_AUDIT_HOME: /data
    volumes:
      - reports:/data
    restart: unless-stopped

volumes:
  reports:
```

### Satu risiko yang harus diuji, bukan diasumsikan

[bin/seo-audit.mjs:372-385](../bin/seo-audit.mjs#L372-L385) mematikan server
ketika stdin adalah **pipe atau socket**, karena itulah caranya shell native tahu
induknya sudah pergi. Compose secara default memberi container `/dev/null`
sebagai stdin (character device, bukan pipe), jadi seharusnya aman — tapi kalau
`stdin_open: true` pernah ditambahkan, containernya akan **keluar seketika saat
start**, dan gejalanya akan terbaca seperti crash. Jangan tambahkan
`stdin_open`, dan verifikasi dengan `docker compose up` betulan sebelum
menyebut fase ini selesai.

---

## Fase 5 — Workflow

### `test.yml` — jadikan bisa dipanggil

Tambahkan `workflow_call` ke pemicunya supaya `release.yml` bisa memakainya
ulang, persis seperti `ci.yml` di chess-js:

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_call:
```

Pertimbangkan juga menambahkan `windows-latest` ke matriksnya. Saat ini hanya
`ubuntu-latest`, dan itulah sebabnya bug `fileURLToPath` di
`scripts/check-levels.mjs` tidak pernah tertangkap.

### `release.yml` — baru

```yaml
name: Release

# Pola tag yang ketat, bukan `v*`. Tag `v1` mengambang maju setiap rilis yang
# kompatibel, dan `v*` cocok dengannya — jadi setiap rilis kompatibel akan
# memicu build kedua untuk versi yang tidak ada. test/workflows.test.mjs
# menegakkan ini.
on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+'

permissions:
  contents: read
  packages: write

jobs:
  # Sebuah tag tidak dengan sendirinya berarti kodenya sehat.
  verify:
    uses: ./.github/workflows/test.yml

  publish:
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            type=raw,value=latest
          labels: |
            org.opencontainers.image.title=seo-audit

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Tidak ada matriks — hanya ada satu image. Tidak ada job yang menulis ke release,
jadi `contents: read` sudah cukup dan test "a workflow that writes to a release
asks for permission to" tetap lolos tanpa perlu apa-apa.

---

## Fase 6 — Dokumentasi

- **README.md** — 25 penyebutan Raycast/macOS/Homebrew/winget/desktop. Bagian
  "A window instead of a terminal", "In Raycast", dan "The window, on Linux and
  Windows" digantikan satu bagian Docker. Sertakan alasan loopback-nya, jangan
  hanya perintahnya.
- **CLAUDE.md** — tabel front end menyusut jadi `serve.mjs` / `library.mjs` /
  `worker/index.mjs`; bagian "Releasing" ditulis ulang seluruhnya (tidak ada
  lagi empat berkas versi, tidak ada tiga workflow, tidak ada `v1` mengambang
  kalau tidak ada lagi yang memakai `uses: nurkamol/seo-audit@v1` — tapi
  `action.yml` masih ada, jadi `v1` **tetap** perlu dipertahankan); "Adding a
  flag" mencatat pengecualian action.yml untuk flag khusus server.
- **docs/index.html** — menyebut Homebrew dan Raycast.
- **CONTRIBUTING.md** — sudah kedaluwarsa sebelum pekerjaan ini (kontrak
  "Adding a check" di sana tidak menyebut `areas.mjs` maupun `score.mjs`).
  Perbaiki sekalian, atau tunjuk ke CLAUDE.md.
- **CHANGELOG.md** — satu entri untuk semuanya.

---

## Urutan pengerjaan

Fase 1 → 2 dulu, dan pastikan `npm test` hijau, sebelum menyentuh Docker sama
sekali. Alasannya: setelah `pretest` dan `raycast/` hilang, `npm test` akhirnya
bisa dijalankan di mesin Windows ini, dan itu yang akan memberi umpan balik
untuk semua sisanya. Fase 3 → 4 lalu bisa diverifikasi betulan dengan
`docker compose up --build`, bukan dengan menebak.

Empat kegagalan test yang tersisa di Windows (`/dev/null`, path
`Application Support`, kematian induk POSIX, dan test `--os` yang bergantung
host) tidak berhubungan dengan pekerjaan ini — semuanya sudah ada sebelumnya,
dan tercatat di CLAUDE.md.
