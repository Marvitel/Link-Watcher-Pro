import express, { type Express } from "express";
import fs from "fs";
import path from "path";

// Gera uma versão única baseada no timestamp do build
// Isso é lido uma vez quando o servidor inicia
let buildVersion: string | null = null;

function getBuildVersion(distPath: string): string {
  if (buildVersion) return buildVersion;
  
  // Tenta ler a versão do package.json ou usar o timestamp do index.html
  try {
    const indexPath = path.resolve(distPath, "index.html");
    const stats = fs.statSync(indexPath);
    buildVersion = stats.mtime.getTime().toString(36);
  } catch {
    buildVersion = Date.now().toString(36);
  }
  
  return buildVersion;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const version = getBuildVersion(distPath);
  console.log(`[Static] Build version: ${version}`);

  // Servir assets estáticos com cache apropriado
  // Assets com hash no nome (ex: main-abc123.js) podem ter cache longo
  // Outros arquivos devem ter cache curto
  app.use(express.static(distPath, {
    maxAge: '1y', // Cache longo para assets hasheados
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      // index.html e outros HTMLs NÃO devem ser cacheados
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      // Assets com hash podem ter cache longo (Vite adiciona hash automaticamente)
      else if (/\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      // Outros arquivos têm cache curto
      else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }
  }));

  // fall through to index.html if the file doesn't exist
  // Importante: index.html sempre sem cache
  app.use("*", (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
