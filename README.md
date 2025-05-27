# User and Transaction Relationship Visualization System

A graph-based visualization system for detecting and analyzing relationships between users and transactions, built with Node.js, TypeScript, and Neo4j. This system identifies patterns and connections through shared attributes and transaction histories.

- Backend Repository Link: [https://github.com/Harsh2563/flagright-backend](https://github.com/Harsh2563/flagright-backend)
- Frontend Repository Link: [https://github.com/Harsh2563/flagright-frontend](https://github.com/Harsh2563/flagright-frontend)
- Frontend Deployed Link: [https://flagright-frontend.vercel.app](https://flagright-frontend.vercel.app)
- Backend Deployed Link: [https://flagright-backend-tvkg.onrender.com](https://flagright-backend-tvkg.onrender.com)

---

## Table of Contents
- [Features](#features)
- [Technologies Used](#technologies-used)
- [Relationship Types](#relationship-types)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [API Endpoints](#api-endpoints)
- [Development](#development)
- [Scripts](#scripts)
- [Graph Visualization](#graph-visualization)
- [Troubleshooting](#troubleshooting)
- [Folder Structure](#folder-structure)
- [Video Demonstration](#video-demonstration)

## Features

- **Relationship Detection**
  - 🔍 User-to-User connections through shared attributes
  - 📱 Device and IP pattern recognition
  - 💳 Payment method correlation

- **Graph Visualization**
  - 📊 Interactive network visualization
  - 🎨 Color-coded relationship types
  - 🔍 Zoom and filter capabilities

- **Data Management**
  - ✨ RESTful API endpoints
  - 📝 CRUD operations for users and transactions
  - 🔐 Data validation and sanitization

- **System Features**
  - 🚀 Docker containerization
  - 📈 Neo4j graph database
  - ⚡ TypeScript/Node.js backend
  - 🌐 CORS-enabled API

## Technologies Used

- **Backend Framework**: [Node.js](https://nodejs.org/) with [Express](https://expressjs.com/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Database**: [Neo4j](https://neo4j.com/) graph database
- **Containerization**: [Docker](https://www.docker.com/) and Docker Compose
- **Visualization**: [Cytoscape.js](https://js.cytoscape.org/)

## Relationship Types

- **Direct Transaction Links**
  - Credit transfers between users
  - Debit transactions
  - Transaction chains
- **Shared Attribute Links**

  - Email address matches
  - Phone number connections
  - Physical address sharing
  - Common payment methods

- **Transaction Pattern Links**
  - Common IP addresses
  - Shared device IDs

## Prerequisites

- Node.js (v20 or higher)
- Docker and Docker Compose
- Git

## Quick Start

1. Clone the repository:

```bash
git clone https://github.com/Harsh2563/flagright-backend.git
cd backend
```

2. Create and configure environment:

   - Create a new file named `.env` in the root directory
   - Add the following configuration (update values as needed):

   ```bash
   # Server Configuration
   PORT=5000
   NODE_ENV=development

   # Neo4j Database Configuration
   NEO4J_URI=bolt://neo4j:7687 or (Aura URI)
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_secure_password
   AURA_INSTANCEID=6bc09cfe (For Aura Database)
   AURA_INSTANCENAME=Instance01 (For Aura Database)

   # Frontend Configuration (CORS)
   CLIENT_ORIGIN=https://flagright-frontend.vercel.app
   ```

3. Start the services using Docker Compose:

```bash
docker compose up -d
```

The services will be available at:

- Backend API: http://localhost:5000
- Neo4j Browser: http://localhost:7474

## API Endpoints

### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/users` | Create or update user information |
| GET | `/users` | List all users |
| GET | `/users/search` | Get filtered users |

### Transaction Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/transactions` | Record a new transaction |
| GET | `/transactions` | List all transactions |
| GET | `/transactions/search` | Get filtered transaction |

- `GET /transactions` - List all transactions with filtering
- `GET /transactions/:id` - Get transaction details

### Relationship Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/relationships/user/:id` | Get all connections of a user |
| GET | `/relationships/transaction/:id` | Get transaction connections |

## Development

1. Install dependencies:

```bash
npm install
```

2. Run in development mode:

```bash
npm run dev
```

3. Build for production:

```bash
npm run build
```

The services will be available at:
- Backend API: http://localhost:5000
- Neo4j Browser: http://localhost:7474

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Runs the server in development mode with nodemon |
| `npm run build` | Compiles TypeScript for production |
| `npm start` | Starts the production server |

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Rebuild after changes
docker-compose up -d --build
```

Make sure to:

1. Replace `your_secure_password` with a strong password
2. Update `CLIENT_ORIGIN` if your frontend URL is different
3. Keep `NEO4J_URI` as shown for Docker setup

## Graph Visualization

The system provides interactive visualization through Neo4j Browser and the frontend application.

### Neo4j Browser (Development)
Access the Neo4j Browser at http://localhost:7474 for direct graph interaction:

- View and manipulate the graph database
- Run custom Cypher queries
- Analyze data patterns
- Export graph data

### Frontend Visualization Features
The web interface provides:

- 📊 Interactive graph visualization
- 🎨 Color-coded relationships:
- 🔍 Search and filter capabilities:
- 📈 Analysis tools:
  - Path finding between users

## Troubleshooting

1. If Neo4j connection fails:

   - Ensure Neo4j container is running: `docker ps`
   - Check logs: `docker logs neo4j`
   - Verify correct password in `.env`

2. If API server won't start:
   - Check if port 5000 is available
   - Verify all dependencies are installed
   - Check logs: `docker logs backend`

## Folder Structure

```typescript
backend/
├── src/
│   ├── controllers/           # Request handlers
│   │   ├── user.ts           # User management logic
│   │   ├── transaction.ts    # Transaction operations
│   │   └── relationship.ts   # Relationship detection
│   │
│   ├── interfaces/           # TypeScript type definitions
│   │   ├── user.ts          # User entity types
│   │   ├── transaction.ts   # Transaction types
│   │   └── relationship.ts  # Relationship types
│   │
│   ├── middleware/          # Express middlewares
│   │   ├── validateRequest.ts    # Request validation
│   │   └── validateSearchQuery.ts # Search param validation
│   │
│   ├── models/             # Neo4j data models
│   │   ├── User.ts        # User node schema
│   │   └── Transaction.ts # Transaction node schema
│   │
│   ├── routes/            # API route definitions
│   │   ├── user.ts       # User endpoints
│   │   ├── transaction.ts # Transaction endpoints
│   │   └── relationship.ts # Relationship endpoints
│   │
│   ├── services/         # Business logic layer
│   │   └── neo4j.service.ts # Graph database service
│   │
│   ├── types/           # Type definitions
│   │   └── enums/      # Enumeration types
│   │
│   ├── utils/          # Helper functions
│   │   └── queries.ts  # Neo4j query templates
│   │
│   └── validators/     # Input validation schemas
│
├── docker/            # Docker configuration files
├── tests/            # Test suites
├── docker-compose.yml # Container orchestration
├── Dockerfile        # Container build instructions
├── tsconfig.json    # TypeScript configuration
└── package.json     # Project dependencies
```

---

## Video Demonstration



https://github.com/user-attachments/assets/7cfda17a-11e2-4487-bf31-db7ec3ac921e

