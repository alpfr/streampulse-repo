# Road to SOC 2 Compliance

Achieving SOC 2 compliance (specifically Type II) is a significant undertaking that verifies the security, availability, processing integrity, confidentiality, and privacy of the application’s operational environment over time.

While StreamPulse Analytics is currently a lightweight Node.js + PostgreSQL application running on AWS EKS, there are specific architectural and operational changes required to achieve full SOC 2 compliance.

## 1. Database & Storage Architecture (RDS Migration)

While we have successfully migrated from a local SQLite file to a robust PostgreSQL database running within the EKS cluster, there are still challenges for SOC 2 compliance. 
* **Requirement:** Migrate the in-cluster PostgreSQL deployment to a fully managed database like **Amazon RDS (PostgreSQL)**. 
* **Why:** SOC 2 requires strict **separation of duties**, **point-in-time recovery (PITR)**, **automated backups**, **encryption at rest using KMS**, and **detailed database audit logging** (who accessed what data and when). AWS RDS provides this out-of-the-box. Achieving verifiable audit trails on a self-managed database inside a Kubernetes pod is not sufficient for compliance.

## 2. Access Control & Authentication (Security)

The application currently sits securely behind an AWS Application Load Balancer integrated natively with AWS Cognito mappings for Admin/Editor roles. To meet SOC 2 requirements:
* **MFA Enablement:** Multi-Factor Authentication (MFA) must be strictly enforced for all administrative users in the AWS Cognito User Pool.
* **Role-Based Access Control (RBAC):** The application relies on an "Admin PIN" equivalent (JWT-based). We must transition to assigning distinct, defined roles (e.g., Viewer, Editor, SuperAdmin) to users within Cognito and enforce these permissions at the API layer.
* **Infrastructure Access:** Direct access to the AWS EKS cluster via `kubectl` must be strictly limited to authorized personnel, fully logged via AWS CloudTrail, and restricted by AWS IAM policies.

## 3. Comprehensive Audit Logging (Processing Integrity)

Currently, the application logs high-level upload metadata to an `upload_history` table. SOC 2 requires centralized, immutable logging:
* **Application Logging:** Every sensitive action (login success/failure, data deletion, data export) must be logged with the User ID, Timestamp, IP Address, and the exact Action taken.
* **Centralization:** Logs should be streamed directly out of EKS pods into a secure, immutable log store like **Amazon CloudWatch Logs** or Datadog, ensuring developers and admins cannot alter or delete them.

## 4. Continuous Monitoring & Vulnerability Management

* **Container Scanning:** The Docker image stored in AWS ECR must be automatically scanned for known CVEs (Common Vulnerabilities and Exposures) before deployment ("Scan on Push").
* **Dependency Scanning:** CI/CD tooling (e.g., `npm audit`, Snyk, or GitHub Dependabot) must be enabled on the repository to prevent the introduction of compromised Node.js packages.
* **Uptime Monitoring:** External monitoring systems (like AWS Route 53 Health Checks or Datadog) must be configured to alert the team immediately if the application goes offline (Availability criteria).

## 5. Infrastructure as Code (IaC) & Change Management

SOC 2 dictates that organizations must prove *how* changes make it into production. 
* Manual deployments (e.g., running `kubectl apply` from a laptop) are not permitted. 
* We must establish a formal CI/CD pipeline (e.g., GitHub Actions or AWS CodePipeline) requiring peer code reviews, automated testing, and automated deployment. 
* AWS infrastructure (VPCs, EKS Cluster, ALB, RDS) should be defined completely in Terraform or AWS CloudFormation, ensuring all infrastructure changes are tracked in version control.

## 6. Organizational Policies & Procedures

A large portion of SOC 2 compliance is non-technical. The organization must document and enforce policies such as:
* **Information Security Policy**
* **Incident Response Plan**
* **Disaster Recovery (DR) & Business Continuity Plan (BCP)**
* **Employee Onboarding/Offboarding Checklists** (including background checks)
* **Vendor Risk Management** (vetting Anthropic/Claude's SOC 2 reports, AWS compliance, etc.)

---

### Recommended First Target
If SOC 2 compliance becomes a prioritized requirement, the highest technical priority is **migrating the in-cluster PostgreSQL database to a fully managed Amazon RDS equivalent**. This singular architectural change addresses the most rigorous compliance requirements regarding data durability, encryption, and auditability.
