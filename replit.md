# Internet Link Monitoring System - DPE/SE

## Overview

This is a network monitoring dashboard application for Defensoria Pública do Estado de Sergipe (Public Defender's Office of Sergipe State, Brazil). The system monitors dedicated internet links, tracks bandwidth usage, latency, packet loss, and provides real-time status visualization with SLA compliance tracking and DDoS protection monitoring.

The application is a full-stack TypeScript solution with a React frontend and Express backend, using PostgreSQL for data persistence. It displays real-time metrics for two primary network locations (Sede Administrativa and Central de Atendimento), manages incidents, and provides security event tracking.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack Query (React Query) for server state with 5-second polling for real-time updates
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming (light/dark mode support)
- **Charts**: Recharts for bandwidth and latency visualization
- **Design System**: Material Design 3 inspired with Grafana-style data visualization patterns

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints under `/api/*` prefix
- **Build Tool**: esbuild for production server bundle, Vite for client

### Data Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Tables**: links, metrics, events, ddosEvents, incidents

### Key Design Patterns
- **Monorepo Structure**: Client code in `client/`, server in `server/`, shared types in `shared/`
- **Path Aliases**: `@/` for client source, `@shared/` for shared code
- **Real-time Simulation**: Server generates simulated network metrics every 5 seconds
- **Data Cleanup**: Automatic cleanup of old metrics data to manage storage

### API Endpoints
- `GET /api/stats` - Dashboard aggregate statistics
- `GET /api/links` - List all monitored links
- `GET /api/links/:id` - Single link details
- `GET /api/links/:id/metrics` - Historical metrics for a link
- `GET /api/events` - System events log
- `GET /api/security/ddos` - DDoS event tracking
- `GET /api/sla` - SLA indicator compliance data
- `GET /api/incidents` - Incident management

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **connect-pg-simple**: Session storage (available but sessions not currently implemented)

### Third-Party Libraries
- **Radix UI**: Accessible component primitives (dialog, dropdown, tabs, etc.)
- **Recharts**: Data visualization charts
- **date-fns**: Date formatting with Portuguese (Brazil) locale support
- **Zod**: Runtime type validation
- **class-variance-authority**: Component variant styling

### Development Tools
- **Vite**: Frontend development server with HMR
- **Drizzle Kit**: Database migrations (`npm run db:push`)
- **Replit Plugins**: Runtime error overlay, cartographer, dev banner for Replit environment

### Fonts
- **Inter**: Primary UI font (Google Fonts)
- **JetBrains Mono**: Monospace font for metrics/data display