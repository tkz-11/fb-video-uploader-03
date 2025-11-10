import axios from "axios";
import FormData from "form-data";
import { google } from "googleapis";
import express from "express";

const app = express();
app.use(express.json());

// ======================
// 🔧 CONFIG YOUR TOKEN HERE
// ======================
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.PAGE_TOKEN;

// Service Account JSON (Google Drive API)
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// Auth Google Drive
const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_SERVICE_ACCOUNT,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"]
});
const drive = google.drive({ version: "v3", auth });

// ======================
// 🧩 Function: Upload Facebook Video
// ======================
async function uploadVideoToFacebook(fileId, caption = "Test Upload") {
  // Step 1. Lấy metadata
  const { data: meta } = await drive.files.get({
    fileId,
    fields: "name, size"
  });
  const fileSize = parseInt(meta.size);
  console.log(`🎬 File: ${meta.name} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

  // Step 2. Start phase
  const startRes = await axios.post(
    `https://graph-video.facebook.com/v19.0/${PAGE_ID}/videos`,
    {
      upload_phase: "start",
      file_size: fileSize,
      access_token: PAGE_TOKEN
    }
  );
  console.log("✅ Start phase:", startRes.data);

  const { upload_session_id, start_offset, end_offset, video_id } = startRes.data;

  // Step 3. Upload chunks (~50MB/lần)
  const CHUNK_SIZE = 50 * 1024 * 1024;
  let start = parseInt(start_offset);
  let end = parseInt(end_offset);

  while (start < end) {
    const rangeEnd = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

    // Tải chunk từ Google Drive (stream)
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream", headers: { Range: `bytes=${start}-${rangeEnd}` } }
    );

    // Upload chunk lên Facebook
    const form = new FormData();
    form.append("upload_phase", "transfer");
    form.append("start_offset", start);
    form.append("upload_session_id", upload_session_id);
    form.append("access_token", PAGE_TOKEN);
    form.append("video_file_chunk", res.data, { filename: meta.name });

    const transferRes = await axios.post(
      `https://graph-video.facebook.com/v19.0/${PAGE_ID}/videos`,
      form,
      { headers: form.getHeaders() }
    );

    console.log(
      `📤 Uploaded ${start}-${rangeEnd} → next offset: ${transferRes.data.start_offset}`
    );

    start = parseInt(transferRes.data.start_offset);
    end = parseInt(transferRes.data.end_offset);
  }

  // Step 4. Finish phase
  const finishRes = await axios.post(
    `https://graph-video.facebook.com/v19.0/${PAGE_ID}/videos`,
    {
      upload_phase: "finish",
      upload_session_id,
      access_token: PAGE_TOKEN,
      title: meta.name,
      description: caption
    }
  );

  console.log("🏁 Finish:", finishRes.data);
  console.log(`✅ Video URL: https://www.facebook.com/${video_id}`);
  return video_id;
}

// ======================
// 🧠 API endpoint test
// ======================
app.post("/upload", async (req, res) => {
  try {
    const { fileId, caption } = req.body;
    const videoId = await uploadVideoToFacebook(fileId, caption);
    res.json({ success: true, videoId });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("✅ Facebook Uploader Server running!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server ready on port ${PORT}`));
