# ShopWave

**A cloud-native e-commerce backend and DevOps reference project.**

ShopWave demonstrates how an e-commerce order flow can be built with Node.js, PostgreSQL, Redis, Amazon SQS, and Amazon SES, then packaged and deployed on AWS using Docker, Kubernetes, Terraform, Ansible, GitHub Actions, and Argo CD.

The API handles customer authentication, product browsing, and order creation. A separate worker processes orders asynchronously, sends confirmation emails, and updates order status. PostgreSQL protects inventory updates with transactions and row-level locks, while Redis reduces repeated catalogue reads.

> **Project scope:** This README documents the backend implementation (API and worker) and the wider infrastructure/deployment design in the build guide. A React frontend is referenced in the planned repository layout, but frontend source code is not included here. The API can be exercised with `curl`, Postman, or another HTTP client.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Order lifecycle](#order-lifecycle)
- [Technology stack](#technology-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Data model](#data-model)
- [AWS and infrastructure](#aws-and-infrastructure)
- [CI/CD and GitOps](#cicd-and-gitops)
- [Security and reliability](#security-and-reliability)
- [Frontend status](#frontend-status)
- [Known implementation notes](#known-implementation-notes)
- [Monitoring](#monitoring)
- [Cleanup](#cleanup)

## Features

- **Customer authentication:** Registration and login with bcrypt password hashing and signed JWT access tokens.
- **Product catalogue:** Public product listing with category filtering, text search, pagination, and individual product lookup.
- **Redis caching:** Cache-aside product caching with a five-minute TTL.
- **Order placement:** Stock checks, inventory reservation, order creation, and order-item insertion inside a PostgreSQL transaction.
- **Concurrency protection:** `SELECT ... FOR UPDATE` locks product rows during checkout to prevent concurrent orders from overselling stock.
- **Asynchronous processing:** Orders are sent to an Amazon SQS FIFO queue and handled by a separate worker.
- **Email notifications:** The worker attempts to send order confirmations through Amazon SES.
- **Containerised services:** Multi-stage Docker images run as a non-root user.
- **Infrastructure as code:** Terraform provisions AWS resources; Ansible configures supporting EC2 hosts.
- **Kubernetes deployment:** Deployments, Services, health probes, autoscaling, and network policies define the runtime environment.
- **GitOps delivery:** GitHub Actions builds and scans images; Argo CD watches Kubernetes manifests and deploys changes.
- **Observability:** Prometheus, Grafana, and Alertmanager provide metrics, dashboards, and alert routing.

## Architecture

```mermaid
flowchart TD
    C[Customer / API client] -->|HTTPS| LB[Load balancer]
    LB --> ING[ingress-nginx]
    ING --> API[ShopWave API]

    API -->|Users, products, orders| DB[(Amazon RDS\nPostgreSQL)]
    API -->|Catalogue cache| REDIS[(Amazon ElastiCache\nRedis)]
    API -->|Order message| SQS[[Amazon SQS FIFO]]

    SQS --> WORKER[Order worker]
    WORKER -->|Confirmation email| SES[Amazon SES]
    WORKER -->|Update order status| DB
    WORKER -->|Invalidate user order cache| REDIS

    API -.->|Metrics| PROM[Prometheus]
    PROM --> GRAF[Grafana]
    PROM --> ALERT[Alertmanager]
```

The application runs in Amazon EKS. The API and worker communicate with managed AWS services over the VPC network. The database and Redis are placed in private subnets; external traffic enters through the load balancer and Kubernetes ingress.

## Order lifecycle

1. A customer registers or logs in and receives a JWT. Subsequent protected requests include it as `Authorization: Bearer <token>`.
2. The customer submits `POST /api/orders` with one or more product IDs and quantities.
3. The API starts a PostgreSQL transaction and locks each requested product row using `SELECT ... FOR UPDATE`.
4. The API validates availability, reserves stock, inserts the order and order items, and commits the transaction. The order initially has `pending` status.
5. The API publishes an order message to the SQS FIFO queue, using the user ID as the message group so that a user's orders are processed in order.
6. The worker long-polls SQS, reads the order message, and attempts to send a confirmation email through SES.
7. The worker updates the order status to `confirmed`, invalidates the user's order-cache key, and deletes the queue message after successful message processing.
8. Messages that repeatedly fail are retried by SQS and, after the configured receive limit, moved to the dead-letter queue (DLQ) for inspection.

## Technology stack

| Area | Technologies | Purpose |
|---|---|---|
| API | Node.js 20, Express | HTTP API, routing, middleware |
| Authentication | bcryptjs, jsonwebtoken | Password hashing and JWT authentication |
| Database | PostgreSQL 15, `pg` | Users, products, orders, and order items |
| Cache | Redis 7 | Product catalogue cache and session snapshot |
| Messaging | Amazon SQS FIFO | Asynchronous order processing |
| Email | Amazon SES | Order confirmation messages |
| Object storage | Amazon S3, CloudFront | Product asset storage/delivery in the infrastructure design |
| Containers | Docker | Reproducible service images |
| Orchestration | Amazon EKS, Kubernetes, Helm | Workload scheduling, scaling, and service discovery |
| Infrastructure as code | Terraform | AWS resource provisioning |
| Configuration management | Ansible | Bastion, ops VM, and host configuration |
| CI | GitHub Actions, Trivy | Automated tests, image builds, and vulnerability scans |
| CD / GitOps | Argo CD | Deployments reconciled from Git |
| Observability | Prometheus, Grafana, Alertmanager | Metrics, dashboards, and alerts |

## Repository layout

The build guide uses the following layout. Some directories are infrastructure scaffolding, and the frontend directory is reserved for a future implementation.

```text
shopwave/
├── services/
│   ├── api/                    # Express API
│   │   └── src/
│   ├── worker/                 # SQS order-processing worker
│   │   └── src/
│   └── frontend/               # Planned React frontend; source not included
├── infra/
│   ├── modules/
│   │   ├── vpc/
│   │   ├── eks/
│   │   ├── rds/
│   │   ├── elasticache/
│   │   └── s3/
│   └── environments/
│       └── production/
├── ansible/
│   ├── inventory/
│   └── roles/
│       ├── common/
│       ├── bastion/
│       ├── eks-node-bootstrap/
│       └── ops-vm/
├── k8s/
│   ├── base/
│   └── overlays/
│       └── production/
├── argocd/                     # Argo CD Application definitions
├── docs/                       # Runbooks and project documentation
├── .github/
│   └── workflows/              # GitHub Actions workflows
├── docker-compose.yml          # Local development stack
└── README.md
```

## Getting started

### Prerequisites

For local backend development:

- Git
- Docker Engine or Docker Desktop with the Docker Compose plugin
- Node.js 20 and npm (useful for running a service outside Docker)

For AWS integration and deployment, you will also need an AWS account and appropriately scoped credentials, plus the AWS CLI, Terraform (version `1.7.0` or later), Ansible, `kubectl`, and Helm.

### 1. Clone the repository

Replace the placeholder with your GitHub repository URL:

```bash
git clone https://github.com/<your-username>/shopwave.git
cd shopwave
```

### 2. Configure environment variables

Create local environment files from the examples, if they exist in your checkout:

```bash
cp services/api/.env.example services/api/.env
```

Review the values in [Configuration](#configuration). Do not commit `.env` files or real credentials.

### 3. Start the local services

The Compose setup starts PostgreSQL, Redis, the API, and the worker:

```bash
docker compose up --build
```

Run it in the background with:

```bash
docker compose up --build -d
```

Check service output:

```bash
docker compose logs -f api worker
```

Check the API health endpoint:

```bash
curl http://localhost:3000/health
```

A healthy response reports the database and Redis checks as `healthy`.

> **AWS integration required:** The Compose example runs PostgreSQL and Redis locally, but it does not provision an SQS queue or emulate SES. To test the complete order-processing flow locally, configure a real SQS FIFO queue, a verified SES sender identity, the required IAM permissions, and AWS credentials available to the worker. The example Compose configuration alone is not a fully local AWS substitute.

### 4. Register and log in

Register a customer:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "customer@example.com",
    "password": "change-this-password",
    "name": "ShopWave Customer"
  }'
```

Log in and capture the JWT:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@example.com","password":"change-this-password"}' \
  | jq -r '.token')
```

Use the token on protected endpoints:

```bash
-H "Authorization: Bearer $TOKEN"
```

Newly registered users receive the `customer` role. Product creation is admin-only, so an admin account must be provisioned through a controlled seed or administrative process before testing `POST /api/products`.

To stop the local stack:

```bash
docker compose down
```

To also remove the local PostgreSQL volume and its data (destructive):

```bash
docker compose down -v
```

## Configuration

The API and worker read configuration from environment variables. The exact variables used depend on which integrations are enabled in the environment.

### API

| Variable | Description | Example |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `NODE_ENV` | Runtime environment | `development` |
| `DATABASE_URL` | PostgreSQL connection URL | `postgres://shopwave:password@localhost:5432/shopwave` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `SQS_ORDER_QUEUE_URL` | SQS FIFO order queue URL | Set to your queue URL |
| `AWS_REGION` | AWS region | `ap-south-1` |
| `JWT_SECRET` | Secret used to sign and verify JWTs | Use a long, random secret |
| `S3_BUCKET` | Product asset bucket name | Set to your bucket name |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed by CORS | `http://localhost:3001` |
| `LOG_LEVEL` | Winston log level | `debug` or `info` |
| `APP_VERSION` | Application version included in logs/health output | Git SHA or release version |

### Worker

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection URL | Same database as the API |
| `REDIS_URL` | Redis connection URL | Same Redis endpoint as the API |
| `SQS_ORDER_QUEUE_URL` | SQS FIFO queue URL | Set to your queue URL |
| `AWS_REGION` | AWS region for SQS and SES | `ap-south-1` |
| `FROM_EMAIL` | Verified SES sender address | `noreply@yourdomain.com` |
| `LOG_LEVEL` | Worker log level | `info` |

In AWS, the deployment design uses IAM Roles for Service Accounts (IRSA) for pod-level permissions and AWS Secrets Manager with External Secrets Operator for application secrets. Avoid storing long-lived AWS access keys or production secrets in the repository.

## API reference

The routes below reflect the API implementation described in the build guide.

| Method | Endpoint | Authentication | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Checks PostgreSQL and Redis connectivity |
| `GET` | `/live` | Public | Liveness check for the API process |
| `POST` | `/api/auth/register` | Public | Register a customer and return a JWT |
| `POST` | `/api/auth/login` | Public | Authenticate and return a JWT |
| `GET` | `/api/products` | Public | List products; supports `category`, `search`, `page`, and `limit` query parameters |
| `GET` | `/api/products/:id` | Public | Retrieve one active product |
| `POST` | `/api/products` | Admin JWT | Create a product and invalidate the product-list cache |
| `POST` | `/api/orders` | Customer JWT | Create an order and enqueue it for asynchronous processing |
| `GET` | `/api/orders` | Customer JWT | Retrieve the authenticated user's order history |

### Example: list products

```bash
curl 'http://localhost:3000/api/products?page=1&limit=20'
```

Filter by category or search text:

```bash
curl 'http://localhost:3000/api/products?category=electronics&search=headphones'
```

### Example: place an order

Replace `PRODUCT_ID` with an existing active product UUID:

```bash
curl -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "items": [
      { "productId": "PRODUCT_ID", "quantity": 1 }
    ]
  }'
```

The API responds with `201 Created` and an initial `pending` status when the order request succeeds.

## Data model

The API migration creates four PostgreSQL tables:

| Table | Purpose |
|---|---|
| `users` | Customer/admin identity, password hash, role, and timestamps |
| `products` | Product details, price, category, active flag, and available stock |
| `orders` | Order owner, current status, total amount, and timestamps |
| `order_items` | Products and quantities associated with each order, including price snapshots |

Important constraints include unique user email addresses, non-negative product prices and stock, positive order-item quantities, and foreign keys between users, orders, products, and order items.

## AWS and infrastructure

The production design targets AWS region `ap-south-1` by default. The region is configurable in Terraform.

| Component | Responsibility |
|---|---|
| VPC | Isolated network spanning public and private subnets across Availability Zones |
| Application Load Balancer / ingress | Public entry point for HTTPS traffic into the cluster |
| Amazon EKS | Runs the API and worker containers |
| Amazon RDS for PostgreSQL | Managed relational database in private subnets, with encrypted storage and automated backups |
| Amazon ElastiCache for Redis | Managed cache in private subnets with encryption in transit and at rest |
| Amazon SQS FIFO + DLQ | Ordered order processing and quarantine for repeatedly failing messages |
| Amazon SES | Transactional order confirmation email |
| Amazon ECR | Private container image repositories and image scanning on push |
| Amazon S3 + CloudFront | Private product-asset storage and delivery in the infrastructure design |
| AWS Secrets Manager | Stores database, Redis, and application secrets |
| IAM / IRSA / GitHub OIDC | Grants scoped, short-lived AWS access to workloads and CI jobs |

Terraform state is designed to live in an encrypted, versioned S3 bucket, with DynamoDB used for state locking. The state bucket and lock table must be bootstrapped before the main Terraform backend can use them.

### Provisioning workflow

1. Create the Terraform state bucket and DynamoDB lock table for the target AWS account.
2. Configure AWS credentials and the production Terraform variables, including the database password and bastion key pair details.
3. Initialise and review the production infrastructure plan:

   ```bash
   cd infra/environments/production
   terraform init
   terraform validate
   terraform plan
   ```

4. Review the plan carefully, then provision the infrastructure:

   ```bash
   terraform apply
   ```

5. Use Ansible to configure the bastion host, ops VM, common host settings, and any required node bootstrap tasks. The guide uses AWS EC2 dynamic inventory based on project/environment tags.
6. Configure the cluster add-ons and prerequisites described in the infrastructure guide, including ingress, certificate management, External Secrets Operator, and monitoring.
7. Configure the GitHub Actions OIDC role and repository variables/secrets required by the workflow.
8. Apply/register the Argo CD application, configure DNS to point the application hostnames at the ingress load balancer, and verify TLS certificate issuance.

> **Production caution:** The supplied Terraform examples include learning-oriented defaults (for example, a small single-AZ RDS instance and a single-node Redis setup). Review availability, backup, security-group, SSH source-IP, and deletion settings before using them for production workloads. Always review `terraform plan` before applying changes.

## CI/CD and GitOps

The intended delivery flow is:

```mermaid
flowchart LR
    DEV[Code change] --> PR[Pull request]
    PR --> TEST[GitHub Actions tests]
    TEST --> SCAN[Trivy image scan]
    SCAN --> BUILD[Build and push image to ECR]
    BUILD --> COMMIT[Update Kubernetes image tag in Git]
    COMMIT --> ARGO[Argo CD detects Git change]
    ARGO --> EKS[Rolling deployment on EKS]
```

- GitHub Actions runs tests and security scans, then builds and pushes images to ECR on branch pushes.
- AWS authentication from GitHub Actions uses OIDC and a role assumption flow rather than long-lived AWS access keys.
- Images are tagged with the Git commit SHA so a deployment can be traced to its source revision.
- On `main`, the workflow updates the Kubernetes image tags in Git.
- Argo CD reconciles the cluster with the manifests in the repository. Rollbacks are made by reverting the relevant Git change.

Protect `main` with pull-request reviews and required status checks. Use the conventional commit format when practical, for example `feat(api): add product filtering` or `fix(worker): handle failed queue messages`.

## Security and reliability

- Passwords are stored as bcrypt hashes; plaintext passwords are never stored.
- JWTs are signed with `JWT_SECRET` and expire after seven days in the supplied API implementation.
- Express uses Helmet, CORS restrictions, JSON request-size limits, and API rate limiting.
- Database queries use parameterised values.
- Order stock validation and reservation occur inside a transaction with row-level locks.
- Production secrets are intended to come from Secrets Manager through External Secrets Operator.
- IRSA provides separate IAM roles to Kubernetes service accounts instead of sharing broad node credentials.
- Container images use a non-root runtime user and multi-stage builds.
- The CI workflow scans API and worker images for fixable high- and critical-severity vulnerabilities with Trivy.
- Kubernetes network policies are designed around default-deny traffic with explicit service-to-service allowances.
- SQS messages are retained for retry, with a DLQ configured after three receives in the example infrastructure.

## Frontend status

The build guide reserves `services/frontend/` for a React application and includes a frontend image name in parts of the planned ECR/CI configuration. However, it does not provide React components, package files, Dockerfile, routes, or a frontend implementation.

This means the current backend documentation does **not** include:

- A customer-facing storefront or product UI.
- Browser-based registration, login, cart, or checkout screens.
- Frontend-to-API integration code.
- A completed frontend container build.

The API can still be tested directly with `curl` or Postman. When a React frontend is added, configure `ALLOWED_ORIGINS` for its deployed origin and add the frontend's build, container, and Kubernetes deployment files. Until then, remove or disable the `frontend` entry in any CI build matrix that expects `services/frontend/Dockerfile` to exist.

## Known implementation notes

These details are worth understanding before treating the example as a production payment/order system:

1. **Database commit and queue publish are separate operations.** The API commits the PostgreSQL transaction before publishing to SQS. If publishing fails after the commit, an order may remain `pending` without a corresponding queue message. A transactional outbox and a publisher retry process would provide a stronger delivery guarantee.
2. **Email failure does not currently stop order confirmation.** The worker catches and logs an SES send error, then continues to update the order to `confirmed`. If confirmation status must mean the email was successfully sent, change the worker's failure handling and track email-delivery state separately.
3. **Admin provisioning is not exposed as a public route.** Registration assigns the `customer` role. Create or promote admin accounts through a controlled administrative process, not through an unauthenticated endpoint.
4. **The metrics endpoint needs to be implemented.** The observability guide configures Prometheus to scrape `/metrics` and describes adding `prom-client`; ensure the API actually exposes the endpoint before relying on application-level dashboards and alerts.
5. **AWS-backed order processing is not fully emulated by the local Compose stack.** SQS, SES, queue redrive policy, and AWS IAM permissions must be configured separately.

## Monitoring

The deployment guide uses the `kube-prometheus-stack`, which includes Prometheus, Grafana, Alertmanager, node-exporter, and kube-state-metrics.

The planned ShopWave alerts cover:

- API 5xx error rate above 5% for two minutes.
- API p99 latency above one second for five minutes.
- Containers restarting more than three times within 15 minutes.
- An HPA remaining at its maximum replica count for ten minutes.
- More than 500 visible messages in the order queue for five minutes.

The API's `/health` endpoint is intended for readiness checks; `/live` is a simpler process liveness check. Use Grafana dashboards to review request rate, error rate, latency, resource usage, and autoscaling behavior.

## Cleanup

Destroying the environment can permanently delete application infrastructure and data. Back up anything you need and review the Terraform plan before proceeding.

A typical cleanup sequence is:

1. Remove or scale down application workloads and cluster add-ons that Terraform does not manage.
2. Run Terraform destroy from the production environment directory, supplying secrets through environment variables or a secure variable file rather than putting passwords directly in shell history:

   ```bash
   cd infra/environments/production
   export TF_VAR_db_password='<database-password>'
   terraform plan -destroy
   terraform destroy
   unset TF_VAR_db_password
   ```

3. After the infrastructure is removed and the state is no longer needed, separately remove the Terraform state bucket and DynamoDB lock table if they were created only for this environment. Do not delete the state backend while Terraform still needs it.

---





