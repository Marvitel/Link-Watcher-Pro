import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Diretório base calculado uma vez na inicialização
// Em produção: esbuild define __dirname no bundle CJS
// Em desenvolvimento: usa process.cwd() ou import.meta.url
let _dirname: string;

// Verifica se estamos em ambiente CJS com __dirname definido pelo esbuild
declare const __dirname: string | undefined;

if (typeof __dirname === 'string' && __dirname) {
  _dirname = __dirname;
} else {
  // Fallback: usar diretório do processo (funciona em dev com tsx)
  _dirname = process.cwd();
}

// Versão do build - calculada do conteúdo real dos arquivos
// Cacheada para ser estável durante toda a vida do servidor
let cachedBuildVersion: string | null = null;

// Exportada para uso em /api/version
export function getBuildVersion(): string {
  // Retorna versão cacheada se já calculada (estável durante sessão do servidor)
  if (cachedBuildVersion) return cachedBuildVersion;
  
  // Em desenvolvimento, usar versão fixa para evitar reloads em loop
  if (process.env.NODE_ENV === 'development') {
    cachedBuildVersion = 'dev-stable';
    console.log(`[Version] Build version (dev): ${cachedBuildVersion}`);
    return cachedBuildVersion;
  }
  
  // Em produção, calcula do hash do index.html
  const distPath = path.resolve(_dirname, "public");
  try {
    const indexPath = path.resolve(distPath, "index.html");
    // Usa hash do conteúdo (estável até próximo deploy)
    const content = fs.readFileSync(indexPath, 'utf-8');
    cachedBuildVersion = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
  } catch {
    // Fallback: usar versão fixa
    cachedBuildVersion = 'build-unknown';
  }
  
  console.log(`[Version] Build version: ${cachedBuildVersion}`);
  return cachedBuildVersion;
}

// Força recálculo da versão (útil para hot-reload em dev)
export function invalidateBuildVersion(): void {
  cachedBuildVersion = null;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(_dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const version = getBuildVersion();
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
