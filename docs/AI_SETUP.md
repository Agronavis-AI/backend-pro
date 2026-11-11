# Sahayak and the scanner: server setup

Everything here is free and open: open-weight models on free tiers, an open embedding model, public datasets and Colab's free GPU. Each part still works when the parts after it are missing.

| Part | What it gives farmers | Where it runs | Repo |
|---|---|---|---|
| 1. Online Sahayak | Answers on any signal, with nothing to download | Render → Groq / Cloudflare | this one |
| 2. Knowledge base | Answers grounded in KCC and state crop guides, with sources | Supabase (pgvector) | this one |
| 3. Offline model | Answers with no signal at all | The phone (Gemma 3 1B, about 550 MB) | Agronavis-App |
| 4. Disease model v2 | Scans trained on field photos, ranked within the crop the farmer picks | Render (ONNX on CPU) | this one |
| 5. Keeping the free server awake | No one-minute cold start | GitHub Actions | this one (already on) |

The app goes online first, then to the phone's model, then keeps the question for later:

```
question ─► online? ─yes─► API ─► knowledge search (Supabase + bge-m3)
              │                 └► Groq gpt-oss-120b ─(quota spent)─► gpt-oss-20b ─► Cloudflare Gemma 4
              no
              ▼
        offline model on phone? ─yes─► Gemma 3 1B answers on the handset
              no
              ▼
        saved; answered in the same chat when the network returns
```

---

## 1. Online Sahayak (about 10 minutes)

**Groq** (the main model):
1. Sign in at [console.groq.com](https://console.groq.com) and go to *API Keys* ▸ *Create*.
2. Copy the key into `GROQ_API_KEY`.

**Cloudflare Workers AI** (the backup model, and the search embeddings):
1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (free account) and go to *AI* ▸ *Workers AI* ▸ *Use REST API*.
2. Copy the **Account ID** into `CLOUDFLARE_ACCOUNT_ID`.
3. Click *Create a Workers AI API Token* and copy it into `CLOUDFLARE_API_TOKEN`.

**On Render:** open the `agronavis-api` service ▸ *Environment*, add the three keys and save. Render redeploys. In the logs, the warning `No GROQ_API_KEY or CLOUDFLARE_* keys` should be gone, and `GET /api/v1/sahayak/status` (signed in) returns `{"online": true}`.

Locally, put the same keys in `.env` (see `.env.example`).

**Models.** `SAHAYAK_MODELS` is the order they are tried in. It has a default in `src/config/env.ts`; set it on Render to change the order without a release:

```
groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,cloudflare:@cf/google/gemma-4-26b-a4b-it
```

Groq retired its free Llama models on 16 August 2026, and the list will keep moving. When a model id stops working, the API skips to the next one and logs which one failed (`No model answered: groq:… → HTTP 404`). Check the [Groq models page](https://console.groq.com/docs/models) and [Workers AI models](https://developers.cloudflare.com/workers-ai/models/), then update the variable. Try a few Hindi questions after any change: models differ more there than in English.

**Limits.** Free tiers have daily caps per account; your current numbers are in each console. `SAHAYAK_DAILY_LIMIT` (default 40) stops one farmer spending everyone's allowance. A farmer who reaches it is moved to the offline model, or told to ask again tomorrow.

**Privacy.** The app leaves the farmer's name out of what goes online. Groq does not retain inference data by default, and Cloudflare does not train on prompts. The app's privacy policy says this (Agronavis-App, `features/legal/documents.ts`).

## 2. Knowledge base (about 30 minutes, once)

1. **Create the table:** `npm run db:link` then `npm run db:push`, or paste `supabase/migrations/0029_knowledge_base.sql` into the Supabase SQL editor. It needs pgvector 0.8 or later, which current Supabase projects have.
2. **Build the notes:** open `ml/knowledge/build_knowledge_base.ipynb` in Colab (*File ▸ Upload notebook*).
   - Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under 🔑 *Secrets*.
   - Choose a T4 GPU and run all cells.
   - It loads Kisan Call Centre answers for WB, Bihar, UP, Jharkhand, Odisha and Assam from 2019 on.
   - It drops weather and price questions, non-answers and anything naming a banned pesticide, then de-duplicates, embeds with bge-m3 and uploads.
   - About 30,000 notes, roughly 150 MB of the 500 MB free database.
3. **Add your crop guides:** drop PDFs into `MyDrive/agronavis/knowledge/docs/` with a `docs_manifest.csv` and re-run. Good first files are the West Bengal package-of-practice guides for boro and aman rice, potato, jute and mustard, and your district KVK's advisories.

Until the table exists, Sahayak still answers; it just has no notes to cite, and the API logs `Knowledge base not set up` once.

## 3. Offline model

The phone's model is served from a GitHub release on **jpdevhub/Agronavis-App** (`offline-model-v1`), because Gemma 3 1B is behind a licence click-through on Hugging Face. The steps are in that repo's `docs/AI_SETUP.md`. Nothing on this server is involved.

## 4. Disease model v2 (about 1–2 hours, mostly waiting)

1. Download the field datasets listed in `ml/disease/train_disease_v2.ipynb`: RiceLeafBD, Dhan-Shomadhan, the potato field set. PlantDoc is cloned for you. Put each in `MyDrive/agronavis/disease/raw/<name>/`.
2. **Add your own photos** as `raw/own_photos/<class>/…`. They are used for testing only, and they are the score that matters.
3. Run the notebook on a T4. Check the label table it prints and the report at the end, especially *within crop* accuracy on field sources.
4. Copy `disease_v2.onnx` and `labels.json` into `model/v2/`, commit on a branch and open a PR. Once merged and deployed, the server switches to v2 by itself, and falls back to v1 if the files are missing or disagree with each other.
5. Run `npm run seed:diseases` so the reference library has the new classes.

Already live without retraining: the app asks *which crop is this?*, and the server ranks only that crop's diseases with the current model. A rice leaf can no longer come back as tomato blight.

## 5. Keeping the free server awake

Already done: `.github/workflows/keepalive.yml` pings `/health` every 10 minutes. Render's free plan sleeps after 15 minutes without traffic, and a workspace's 750 free instance hours a month cover one always-on service (744 hours in a 31-day month), not two.

Two things to watch:
- GitHub turns scheduled workflows off in a public repository after 60 days with no commits. If that happens, *Actions* ▸ *Keep the API awake* ▸ *Enable workflow*. A free [cron-job.org](https://cron-job.org) job on the same URL every 10 minutes is a backup that does not expire.
- Render can still restart a free instance at any time. When there are paying users, the $7/month Starter plan removes both the sleep and the restarts.

---

## Checklist before release

- [ ] Render: `GROQ_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` set
- [ ] Supabase: migration 0029 applied, knowledge notebook run
- [ ] Agronavis-App: release `offline-model-v1` with the model, `NOTICE` and the Gemma terms; new Android build
- [ ] Play Console *Data safety* updated; privacy policy page republished
- [ ] Keepalive workflow enabled (Actions tab)
- [ ] (When trained) `model/v2/` added and `seed:diseases` run
