import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/links", async (req, res) => {
    try {
      const links = await storage.getLinks();
      res.json(links);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch links" });
    }
  });

  app.get("/api/links/:id", async (req, res) => {
    try {
      const link = await storage.getLink(req.params.id);
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }
      res.json(link);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link" });
    }
  });

  app.get("/api/links/:id/metrics", async (req, res) => {
    try {
      const metrics = await storage.getLinkMetrics(req.params.id);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link metrics" });
    }
  });

  app.get("/api/links/:id/events", async (req, res) => {
    try {
      const events = await storage.getLinkEvents(req.params.id);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link events" });
    }
  });

  app.get("/api/links/:id/sla", async (req, res) => {
    try {
      const sla = await storage.getLinkSLA(req.params.id);
      res.json(sla);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch link SLA" });
    }
  });

  app.get("/api/events", async (req, res) => {
    try {
      const events = await storage.getEvents();
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  app.get("/api/alerts", async (req, res) => {
    try {
      const alerts = await storage.getAlerts();
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.get("/api/security/ddos", async (req, res) => {
    try {
      const ddosEvents = await storage.getDDoSEvents();
      res.json(ddosEvents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DDoS events" });
    }
  });

  app.get("/api/sla", async (req, res) => {
    try {
      const sla = await storage.getSLAIndicators();
      res.json(sla);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch SLA indicators" });
    }
  });

  return httpServer;
}
