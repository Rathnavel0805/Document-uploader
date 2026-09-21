# Document Uploader

A Node.js web application for photo and signature uploads. Automatically compresses images to $\le$ 15 KB, converts them to JPEG, and stores them in a MySQL database. Includes a secure passkey-protected admin dashboard.

---

## 🚀 Free Cloud Deployment Guide (Render + TiDB Cloud)

You can host this project **100% free with no credit card required**.

### Step 1: Create your Free MySQL Database (TiDB Cloud)
1. Go to [https://tidbcloud.com](https://tidbcloud.com) and create a free account.
2. Click **Create Cluster** and select **Serverless (Free)**.
3. Once the cluster is active, click **Connect**:
   * Note down: **Host**, **Port** (typically `4000`), **User**, and **Password**.
4. In the TiDB Cloud console, open the **SQL Editor** tab:
   * Copy the entire contents of [`setup.sql`](setup.sql).
   * Paste it into the SQL editor and click **Run**.
   * Both `people` and `documents` tables are now created.

---

### Step 2: Push Your Code to GitHub
1. Initialize git and commit your files (the `.gitignore` will ensure `node_modules` is not pushed):
   ```bash
   git init
   git add .
   git commit -m "Initial commit ready for cloud deployment"
   ```
2. Create a new repository on [GitHub](https://github.com/new) (public or private).
3. Link and push your repository:
   ```bash
   git branch -M main
   git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
   git push -u origin main
   ```

---

### Step 3: Deploy on Render (Free Web Service)
1. Go to [https://render.com](https://render.com) and sign in with GitHub.
2. Click **New +** $\rightarrow$ **Web Service**.
3. Select your GitHub repository.
4. Set the following fields:
   * **Name:** `document-uploader` (or any name you choose)
   * **Runtime:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
   * **Instance Type:** `Free`
5. Scroll down to **Environment Variables** and add:
   * `DB_HOST`: *(Your TiDB host address from Step 1)*
   * `DB_PORT`: `4000`
   * `DB_USER`: *(Your TiDB username)*
   * `DB_PASSWORD`: *(Your TiDB password)*
   * `DB_NAME`: `document_uploader` *(or `test` if that's the default database)*
   * `DB_SSL`: `true`
   * `ADMIN_KEY`: *(Choose an 8+ character secret passkey for the admin portal)*
6. Click **Deploy Web Service**.

Once the build finishes, Render will provide you with a live HTTPS URL (e.g. `https://document-uploader.onrender.com`).

---

## 💻 Local Development Setup

If you want to run the project locally on your machine:

1. **Prerequisites:**
   * Node.js (v18+)
   * MySQL Server running locally
2. **Setup Database:**
   * Open MySQL Workbench, open `setup.sql`, and execute it.
3. **Configure Settings:**
   * Set your local MySQL password in `settings.js` or set environment variables.
4. **Install & Run:**
   ```bash
   npm install
   node server.js
   ```
5. **Access:**
   * Public uploader: `http://localhost:3000`
   * Admin dashboard: `http://localhost:3000/admin`
