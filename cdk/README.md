# Pirate Network product-key service — CDK

Deploys the `services/product-key` server (see `../Dockerfile`) as a single
ECS Fargate service behind a shared ALB, mirroring the CDK setup used in
`must-matchhire/cdk`.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Infrastructure

- `ApplicationFoundation` imports the shared VPC/ECS cluster/ALB from an
  existing foundation stack (`FOUNDATION_STACK`), same as must-matchhire.
- `EcsFargateService` runs the container built from the repo root `Dockerfile`
  (container port `4173`, health check at `/api/health`).
- An EFS file system is attached at `/data` so the SQLite product-key
  database (`/data/product-keys.db`) survives deployments and restarts —
  container disk on Fargate is otherwise ephemeral.

## Required environment variables

All variables in `lib/config.ts` (`VARS` + `SECRETS`) must be set before
synth/deploy — the stack throws if any are missing. `SECRETS` values are
stored in AWS Secrets Manager rather than plaintext container environment,
matching `.env.aws.example`'s guidance to inject `RPC_URL` and `ADMIN_TOKEN`
that way instead of committing them.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
