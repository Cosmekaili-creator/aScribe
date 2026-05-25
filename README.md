<div align="center">
  <img src="logo.svg" height="90" style="vertical-align: middle;" />
  <img src="logo-text.svg" height="80" style="vertical-align: middle;" />
</div>
</br>
</br>
<p align="center">
Scriberr is an open-source, self-hosted audio transcription application designed for privacy and performance.
</p>

<p align="center">
  <a href="https://github.com/Cosmekaili-creator/Scriberr">Source</a> •
  <a href="https://github.com/rishikanthc/scriberr">Upstream project</a>
</p>

<div align="center">
  <img src="screenshots/hero.png" alt="Scriberr Desktop App" width="800" />
</div>

## About this fork

This is a fork of [Scriberr by rishikanthc](https://github.com/rishikanthc/scriberr), maintained for the ARCS architecture agency. It includes all upstream features plus:

- **Internationalization (i18n)**: Full French/English UI, language preference stored per user account and auto-detected from the browser
- Additional cloud transcription providers (AssemblyAI, Deepgram), multi-track Audacity import, and other upstream additions

## Introduction

Scriberr allows you to transcribe audio and video locally on your machine, ensuring no data is ever sent to a third-party cloud provider.
Leveraging state-of-the-art machine learning models (such as **NVIDIA Parakeet**, and **Canary**) or the older more popular **Whisper** models, it delivers high-accuracy text with word-level timing.

Scriberr goes beyond simple transcription and provides various advanced capabilities:

- **Smart Speaker Detection**: Automatically detects different speakers (Diarization) and labels exactly who said what.
- **Chat with your Audio**: Connect seamlessly with Ollama or OpenAI API compatible providers. Generate summaries, ask questions, or have a full conversation with your transcripts right inside the app.
- **Built for your Workflow**: Extensive APIs and a Folder Watcher that automatically processes new files, fitting right into existing automations (like n8n).
- **Capture & Organize**: Built-in audio recorder and integrated note-taking features to annotate your transcripts as you listen.
- **Native Experience everywhere**: PWA (Progressive Web App) installation, giving you a native app experience on desktop or mobile.
- **Multi-language UI**: Switch between English and French in Account Settings; preference is saved per user account.

## Screenshots

<details>
  <summary>Click to expand</summary>

  <p align="center">
    <img alt="Transcript view" src="screenshots/transcript-light.png" width="720" />
  </p>
  <p align="center"><em>Transcript reader with playback follow‑along and seek‑from‑text.</em></p>

  <p align="center">
    <img alt="Chat with Audio" src="screenshots/chat.png" width="720" />
  </p>
  <p align="center"><em>Chat with your transcripts using local LLMs or OpenAI.</em></p>

  <p align="center">
    <img alt="Notes and Highlights" src="screenshots/notes.png" width="720" />
  </p>
  <p align="center"><em>Highlight key moments and take notes while listening.</em></p>

  <p align="center">
    <img alt="AI Summaries" src="screenshots/ai-summary.png" width="720" />
  </p>
  <p align="center"><em>Generate comprehensive summaries of your recordings.</em></p>

  <p align="center">
    <strong style="font-size: 1.2em;">Dark Mode</strong>
  </p>

  <p align="center">
    <img alt="Homepage Dark Mode" src="screenshots/homepage-dark.png" width="720" />
  </p>
  <p align="center"><em>Homepage in Dark Mode.</em></p>

  <p align="center">
    <img alt="Transcript Dark Mode" src="screenshots/transcript-dark.png" width="720" />
  </p>
  <p align="center"><em>Transcript view in Dark Mode.</em></p>

  ### Mobile

  <p align="center">
    <img alt="Mobile Homepage" src="screenshots/homepage-mobile.PNG" width="300" />
    <img alt="Mobile Homepage Dark" src="screenshots/homepage-mobile-dark.PNG" width="300" />
  </p>
  <p align="center"><em>PWA mobile app (Light & Dark).</em></p>

  <p align="center">
    <img alt="Mobile Transcript" src="screenshots/transcript-mobile.PNG" width="300" />
    <img alt="Mobile Transcript Dark" src="screenshots/transcript-mobile-dark.PNG" width="300" />
  </p>
  <p align="center"><em>Mobile transcript reading experience.</em></p>

</details>

## Installation

Get Scriberr running on your system in a few minutes.

### Migrating from v1.1.0

If you are upgrading from v1.1.0, please follow these steps to ensure a smooth transition. Version 1.2.0 introduces a separation between application data (database, uploads) and model data (Python environments).

#### 1. Update Volume Mounts

You will need to update your Docker volume configuration to split your data:

*   **Application Data:** Bind your existing data folder (containing `scriberr.db`, `jwt_secret`, `transcripts/`, and `uploads/`) to `/app/data`.
*   **Model Environment:** Create a **new, empty folder** and bind it to `/app/whisperx-env`.

#### 2. Clean Up Old Environments

> **CRITICAL:** You must delete any existing `whisperx-env` folder from your previous installation.

The Python environment and models need to be reinitialized for v1.2.0. If the application detects an old environment, it may attempt to use it, leading to compatibility errors. Starting with a fresh `/app/whisperx-env` volume ensures the correct dependencies are installed.

### Configuration

Scriberr works out of the box. For Homebrew or manual installations, you can customize the application behavior using environment variables or a `.env` file placed in the same directory as the binary.

> **Docker Users:** You can ignore this section if you are using `docker-compose.yml`, as these values are already configured with sane defaults.

#### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the server listens on. | `8080` |
| `HOST` | The interface to bind to. | `0.0.0.0` |
| `APP_ENV` | Application environment (`development` or `production`). | `development` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma separated). | `http://localhost:5173,http://localhost:8080` |
| `DATABASE_PATH` | Path to the SQLite database file. | `data/scriberr.db` |
| `UPLOAD_DIR` | Directory for storing uploaded files. | `data/uploads` |
| `TRANSCRIPTS_DIR` | Directory for storing transcripts. | `data/transcripts` |
| `WHISPERX_ENV` | Path to the managed Python environment for models. | `data/whisperx-env` |
| `OPENAI_API_KEY` | API Key for OpenAI (optional). | `""` |
| `ASSEMBLYAI_API_KEY` | API Key for AssemblyAI cloud transcription (optional). | `""` |
| `DEEPGRAM_API_KEY` | API Key for Deepgram cloud transcription (optional). | `""` |
| `JWT_SECRET` | Secret for signing JWTs. Auto-generated if not set. | Auto-generated |

### Docker Deployment

For a containerized setup, you can use Docker. Two configurations are provided: standard CPU and NVIDIA GPU (CUDA).

> [!IMPORTANT]
> **Permissions:** Ensure you set the `PUID` and `PGID` environment variables to your host user's UID and GID (typically `1000` on Linux) to avoid permission issues with the SQLite database. You can find your UID/GID by running `id` on your host.
>
> **HTTP vs HTTPS:** By default, Scriberr enables **Secure Cookies** in production. If you are accessing the app via plain HTTP (not HTTPS), you MUST set `SECURE_COOKIES=false` in your environment variables, otherwise you will encounter "Unable to load audio stream" errors.

#### Standard Deployment (CPU)

```yaml
services:
  scriberr:
    image: ghcr.io/rishikanthc/scriberr:v1.2.0
    ports:
      - "8080:8080"
    volumes:
      - scriberr_data:/app/data
      - env_data:/app/whisperx-env
    environment:
      - PUID=${PUID:-1000}
      - PGID=${PGID:-1000}
      - APP_ENV=production
      # - ALLOWED_ORIGINS=https://your-domain.com
      # - SECURE_COOKIES=false
    restart: unless-stopped

volumes:
  scriberr_data: {}
  env_data: {}
```

```bash
docker compose up -d
```

#### NVIDIA GPU Deployment (CUDA)

1.  Ensure you have the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed.
2.  Use `docker-compose.cuda.yml` from this repository and run:

```bash
docker compose -f docker-compose.cuda.yml up -d
```

#### GPU Compatibility

| GPU Generation | Compute Capability | Docker Compose File |
|:---|:---|:---|
| GTX 10-series (Pascal) | sm_61 | `docker-compose.cuda.yml` |
| RTX 20-series (Turing) | sm_75 | `docker-compose.cuda.yml` |
| RTX 30-series (Ampere) | sm_86 | `docker-compose.cuda.yml` |
| RTX 40-series (Ada Lovelace) | sm_89 | `docker-compose.cuda.yml` |
| **RTX 50-series (Blackwell)** | sm_120 | `docker-compose.blackwell.yml` |

### App Startup

When you run Scriberr for the first time, it may take several minutes to start while it:

1. Initializes the Python environments.
2. Downloads the necessary machine learning models (Whisper, PyAnnote, NVIDIA NeMo).
3. Configures the database.

**Subsequent runs will be much faster** because all models and environments are persisted to the `env_data` volume.

You will know the application is ready when you see: `msg="Scriberr is ready" url=http://0.0.0.0:8080`.

### Troubleshooting

#### SQLite OOM Error (out of memory)

If you see an "out of memory (14)" error from SQLite (`SQLITE_CANTOPEN`), it usually means a permissions issue. Fix it by setting `PUID`/`PGID` to match your host user, or:

```bash
sudo chown -R 1000:1000 ./scriberr_data
sudo chown -R 1000:1000 ./env_data
```

#### "Unable to load audio stream"

This is caused by the **Secure Cookies** flag. When `APP_ENV=production`, Scriberr sets `SECURE_COOKIES=true`, which blocks cookies over HTTP.

- **Recommended:** Deploy behind a reverse proxy (Nginx, Caddy, Traefik) with SSL/TLS.
- **Alternative:** Set `SECURE_COOKIES=false` in your `docker-compose.yml` environment.

## Adding a new UI language

1. Copy `web/frontend/src/i18n/en.ts` → `web/frontend/src/i18n/<code>.ts` (e.g. `de.ts`)
2. Translate the values
3. In `web/frontend/src/i18n/index.tsx`, add the language code to `SUPPORTED` and import the catalog
4. Rebuild and redeploy
