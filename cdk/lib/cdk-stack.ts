import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { VARS, SECRETS } from './config';
import { createEcsResources } from './ecs';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const requiredEnvVars = Array.from(new Set([...VARS, ...SECRETS]));

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is not set.`);
      }
    }

    createEcsResources(this);
  }
}
