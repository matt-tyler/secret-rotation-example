const SecretsManager = require('aws-sdk/clients/secretsmanager');

module.exports.lambdaHandler = async (event) => {
    const {
        SecretId: arn,
        ClientRequestToken: token,
        Step: step
    } = event;

    const client = new SecretsManager();

    const metadata = await client.describeSecret({ SecretId: arn}).promise();
    if (!metadata.RotationEnabled){
        throw new Error(`Secret ${arn} is not enabled for rotation`);
    }

    const { VersionIdsToStages: versions } = metadata;
    if (!Object.keys(versions).includes(token)) {
        throw new Error(`Secret Version ${token} has no stage for rotation of secret ${arn}`)
    } else if (versions[token].includes('AWSCURRENT')) {
        return;
    } else if (!versions[token].includes('AWSPENDING')) {
        throw new Error(`Secret version ${token} not set as AWSPENDING for rotation of secret ${arn}.`)
    }

    switch(step) {
        case "createSecret":
            return await createSecret(client, arn, token);
        case "setSecret":
            return await setSecret(client, arn, token);
        case "testSecret":
            return await testSecret(client, arn, token);
        case "finishSecret":
            return await finishSecret(client, arn, token);
        default:
            throw new Error("Invalid step parameter")
    }
}

async function createSecret(client, arn, token) {
    await client.getSecretValue({
        SecretId: arn, VersionStage: 'AWSCURRENT'
    }).promise();

    try {
        await client.getSecretValue({
            SecretId: arn, VersionStage: 'AWSPENDING', VersionId: token
        }).promise();
    } catch (e) {
        if (e.code === 'ResourceNotFoundException') {
            const { RandomPassword: passwd } = await client.getRandomPassword({
                PasswordLength: 4096
            }).promise();

            await client.putSecretValue({
                SecretId: arn,
                ClientRequestToken: token,
                SecretString: passwd,
                VersionStages=['AWSPENDING']
            }).promise();
        } else {
            throw e;
        }
    }
}

async function setSecret(client, arn, token) {
    throw new Error("Not Implemented");
}

async function testSecret(client, arn, token) {
    throw new Error("Not Implemented")
}

async function getCurrentVersion(client, arn) {
    const { VersionIdsToStages: versions } =
        await client.describeSecret({ SecretId: arn }).promise();

    const [version, _ ] = Object.entries(versions)
        .find(([_, stage]) => stage.includes('AWSCURRENT'));

    if (!version) {
        throw new Error('Could not find current version');
    }
    return version;
}

async function finishSecret(client, arn, token) {
    const currentVersion = await getCurrentVersion(client, arn);
    if (currentVersion === token) {
        console.log(`finishSecret: Version ${currentVersion} already marked as AWSCURRENT for ${arn}`);
        return;
    }

    await client.updateSecretVersionStage({
        SecretId: arn,
        VersionStage: 'AWSCURRENT',
        MoveToVersionId: token,
        RemoveFromVersionId: currentVersion
    }).promise();
}
