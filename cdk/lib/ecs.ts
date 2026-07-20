import * as cdk from 'aws-cdk-lib';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Duration } from 'aws-cdk-lib';
import {
    ApplicationFoundation,
    ContainerConfig,
    EcsFargateService,
    EcsTaskConfig,
    ListenerConfig,
    ServiceConfig,
} from 'must-cdk';
import { ECS_TASK_SPECS, SECRETS, TaskSize, VARS } from './config';

export type EcsResources = {
    appFoundation: ApplicationFoundation;
    backendService: EcsFargateService;
};

export function createEcsResources(scope: cdk.Stack): EcsResources {
    const serviceConfig = new ServiceConfig();
    const rawSize = process.env.SIZE;

    const taskSize: TaskSize =
        rawSize && rawSize in ECS_TASK_SPECS ? (rawSize as TaskSize) : 'SMALL';

    const taskConfig = new EcsTaskConfig();
    taskConfig.cpu = ECS_TASK_SPECS[taskSize].cpu;
    taskConfig.memoryLimitMiB = ECS_TASK_SPECS[taskSize].memory;

    const backendContainerConfig = new ContainerConfig();
    serviceConfig.cpuArchitecture = cdk.aws_ecs.CpuArchitecture.X86_64;
    backendContainerConfig.image = cdk.aws_ecs.ContainerImage.fromAsset('../', {
        platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
        exclude: ['cdk/**', 'node_modules/**', '.git/**', '*.md'],
    });

    backendContainerConfig.healthCheck = {
        command: [
            'CMD-SHELL',
            'node -e "fetch(\'http://127.0.0.1:4173/api/health\').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1));"',
        ],
    };

    backendContainerConfig.portMappings = [
        {
            containerPort: 4173,
            protocol: cdk.aws_ecs.Protocol.TCP,
        },
    ];

    taskConfig.containers = [backendContainerConfig];
    serviceConfig.taskConfig = taskConfig;

    const appFoundation = new ApplicationFoundation(scope, 'App', {
        stackName: process.env.FOUNDATION_STACK!,
        listenerID: 'Ssl',
    });

    const backendService = new EcsFargateService(
        scope,
        'BackendService',
        appFoundation,
        serviceConfig,
    );

    const cfnService = backendService.service.node.defaultChild as cdk.aws_ecs.CfnService;
    cfnService.addPropertyOverride('HealthCheckGracePeriodSeconds', 120);

    const scalableTarget = backendService.service.autoScaleTaskCount({
        minCapacity: Number(process.env.MIN_CAPACITY ?? 1),
        maxCapacity: Number(process.env.MAX_CAPACITY ?? 2),
    });

    scalableTarget.scaleOnCpuUtilization('CpuScaling', {
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60),
    });

    for (const envVar of VARS) {
        backendService.addEnvironment(envVar, process.env[envVar]!);
    }
    backendService.addSecrets([...SECRETS]);

    // Persist the product-key SQLite database (issued license keys) across
    // deployments and restarts. Container disk is ephemeral on Fargate, so
    // /data is backed by EFS instead of the task's local storage.
    const fileSystem = new efs.FileSystem(scope, 'ProductKeyData', {
        vpc: appFoundation.network.vpc,
        vpcSubnets: appFoundation.network.privateSubnets,
        encrypted: true,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const accessPoint = fileSystem.addAccessPoint('ProductKeyAccessPoint', {
        path: '/product-keys',
        createAcl: {
            ownerUid: '1000',
            ownerGid: '1000',
            permissions: '0700',
        },
        posixUser: {
            uid: '1000',
            gid: '1000',
        },
    });

    backendService.attachEfs(fileSystem, accessPoint, '/data');
    backendService.addEnvironment('DATABASE_PATH', '/data/product-keys.db');

    const listenerConfig = new ListenerConfig();
    listenerConfig.destinationPort = 4173;
    listenerConfig.protocol = cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP;
    listenerConfig.domainRoutingName = process.env.SERVER_URL!;
    listenerConfig.priority = process.env.PRIORITY
        ? parseInt(process.env.PRIORITY)
        : 30;
    listenerConfig.healthCheck = {
        path: '/api/health',
        healthyHttpCodes: '200',
    };

    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(
        scope,
        'ExistingListener',
        {
            listenerArn: appFoundation.albListenerArn,
            securityGroup: appFoundation.securityGroup,
        },
    );

    appFoundation.addListenerAction(backendService.service, listener, listenerConfig);

    return {
        appFoundation,
        backendService,
    };
}
