# Design Guidelines: Internet Link Monitoring System
## Defensoria Pública do Estado de Sergipe

### Design Approach: Data-First Dashboard System

**Selected Framework**: Material Design 3 with Grafana-inspired data visualization patterns
**Rationale**: Network monitoring demands clarity, real-time data comprehension, and operational efficiency. Material Design 3 provides robust component patterns for data-dense interfaces while maintaining visual hierarchy and accessibility.

---

## Core Design Principles

1. **Data Primacy**: Information visibility over decoration
2. **Status Clarity**: Instant comprehension of network health
3. **Hierarchical Density**: Layer information logically without overwhelming
4. **Operational Efficiency**: Minimize clicks to critical actions

---

## Layout System

### Spacing Scale
**Tailwind Units**: Consistently use 2, 3, 4, 6, 8, 12, 16
- Component padding: `p-4`, `p-6`, `p-8`
- Section spacing: `gap-6`, `gap-8`
- Page margins: `px-6 lg:px-8`

### Grid Structure
- **Sidebar Navigation**: Fixed 64px (collapsed) / 256px (expanded) - `w-16 lg:w-64`
- **Main Content**: Fluid with `max-w-7xl mx-auto`
- **Dashboard Cards**: 12-column grid - `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`

---

## Typography Hierarchy

**Font Stack**: Inter (primary), JetBrains Mono (data/metrics)

```
Page Titles: text-2xl font-semibold (32px)
Section Headers: text-xl font-semibold (24px)
Card Titles: text-lg font-medium (20px)
Body Text: text-base (16px)
Metadata/Labels: text-sm text-gray-600 (14px)
Metrics/Data: font-mono text-lg font-semibold
Status Indicators: text-xs font-medium uppercase tracking-wide
```

---

## Component Library

### Navigation
**Left Sidebar**:
- Logo/Institution name at top
- Icon-based navigation (collapsed state)
- Expandable with labels
- Active state: subtle background + border-left accent
- Sections: Dashboard, Links Overview, Sede Administrativa, Central de Atendimento, Security, Reports, Settings

### Status Cards
**Primary Metrics Display**:
- Compact header with icon + title
- Large metric value (font-mono, 2xl-3xl)
- Trend indicator (small arrow + percentage)
- Timestamp footer (text-xs)
- Status badge (top-right corner)

**Link Status Cards**:
- Location identifier (Sede/Central)
- Real-time bandwidth graph (sparkline)
- IP block information
- Uptime percentage
- Latency metrics
- Quick action buttons (Test, Details, Alerts)

### Data Visualization
**Network Graphs**:
- Time-series line charts for bandwidth usage
- Color-coded: Upload (blue), Download (green), Threshold (red dashed)
- 24h / 7d / 30d view toggles
- Hover tooltips with precise values + timestamps

**Security Dashboard**:
- DDoS attack timeline
- Firewall event log (table with filtering)
- Blocked IP counter
- Traffic analysis pie chart

### Tables
**Event/Log Tables**:
- Zebra striping for readability
- Fixed header on scroll
- Sortable columns
- Status indicators (colored dots)
- Expandable rows for details
- Pagination + items per page selector

### Alerts & Notifications
**Alert Banner** (top of page when active):
- Critical: Red background, white text
- Warning: Amber background
- Info: Blue background
- Dismissible with X button
- Inline action buttons

**Notification Center** (header icon):
- Dropdown list
- Grouped by severity
- Real-time updates
- Mark as read functionality

---

## Dashboard Layouts

### Main Dashboard View
**Top Section** (3-column grid):
- Overall Status Card (green/amber/red indicator)
- Combined Bandwidth Card (both links aggregate)
- Active Incidents Card

**Link Monitoring** (2-column grid):
- Sede Administrativa Link Card
- Central de Atendimento Link Card
Each includes: live bandwidth graph, IP info, status, quick metrics

**Recent Activity**:
- Full-width event timeline
- Last 20 events with filtering

### Individual Link Detail Page
**Header**: Breadcrumb + Location Name + Status Badge
**Metrics Row** (4-column grid):
- Uptime, Latency, Packet Loss, Current Bandwidth

**Graphs Section**:
- Large bandwidth usage chart (full width)
- Latency trend chart
- Packet loss visualization

**Configuration Details** (2-column):
- IP Block Information (left)
- Equipment/Firewall Status (right)

---

## Interactive Elements

### Buttons
- Primary: Solid fill, medium rounded corners (`rounded-md`)
- Secondary: Outlined
- Danger: Red fill for critical actions
- Ghost: Transparent with hover state
- Icon buttons: Square, consistent 40px hit target

### Form Inputs
- Border: 1px solid with focus ring
- Height: h-10 for text inputs
- Labels: Above input, text-sm font-medium
- Validation: Inline error messages below field

### Tabs
- Underline style (border-b-2 on active)
- Equal width tabs for primary navigation
- Icon + label combination

---

## Status Indication System

**Network Status Colors**:
- Operational: Green (#10b981)
- Degraded: Amber (#f59e0b)
- Down: Red (#ef4444)
- Maintenance: Blue (#3b82f6)

**Implementation**: Colored dot + text label, consistent sizing (w-2 h-2 for dots)

---

## Images

**Dashboard Background**: None - prioritize data visibility
**Login/Error Pages**: Abstract network topology illustration (geometric lines/nodes)
**Empty States**: Simple line illustrations with helpful text

---

## Accessibility Requirements

- WCAG 2.1 AA compliance throughout
- High contrast ratios for all text (4.5:1 minimum)
- Keyboard navigation for all interactive elements
- ARIA labels for icon-only buttons
- Focus indicators clearly visible
- Screen reader announcements for real-time data updates

---

## Responsive Behavior

**Mobile (< 768px)**:
- Collapsed sidebar (hamburger menu)
- Single-column card layout
- Simplified graphs (height reduction)
- Bottom navigation for primary actions

**Tablet (768px - 1024px)**:
- 2-column dashboard grid
- Persistent sidebar (icon-only)

**Desktop (> 1024px)**:
- Full 3-column layouts
- Expanded sidebar with labels
- Maximum data density

---

## Performance Considerations

- Lazy load historical data graphs
- Real-time updates via WebSocket (not polling)
- Virtualized tables for logs (display 50 rows, load more on scroll)
- Debounce search/filter inputs (300ms)