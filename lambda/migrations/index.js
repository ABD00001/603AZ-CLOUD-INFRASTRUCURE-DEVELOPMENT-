'use strict';

/*
 * ============================================================================
 * FairWork Pulse - Database Migration and Development Seed Lambda
 * ============================================================================
 *
 * Default behaviour:
 *   {} or {"action":"migrate"}
 *       -> Runs version-controlled database migrations.
 *
 * Development behaviour:
 *   {"action":"seed"}
 *       -> Runs seeds/development_seed.sql.
 *
 * The seed is NEVER executed automatically during a normal migration.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const mysql = require('mysql2/promise');

const {
    SecretsManagerClient,
    GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');


/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const MIGRATION_PATTERN = /^(V\d{3,})__(.+)\.sql$/;

const DEVELOPMENT_SEED_FILENAME = 'development_seed.sql';

const ALLOWED_ACTIONS = new Set([
    'migrate',
    'seed'
]);


/* ============================================================================
 * ENVIRONMENT VARIABLE HELPER
 * ========================================================================== */

function getRequiredEnvironmentVariable(name) {

    const value = process.env[name];

    if (!value) {
        throw new Error(
            `Required environment variable "${name}" is not configured.`
        );
    }

    return value;
}


/* ============================================================================
 * AWS SECRETS MANAGER
 * ========================================================================== */

async function getDatabaseCredentials(secretArn, region) {

    console.log(
        'Retrieving database credentials from AWS Secrets Manager.'
    );

    const secretsManager = new SecretsManagerClient({
        region
    });

    const response = await secretsManager.send(
        new GetSecretValueCommand({
            SecretId: secretArn
        })
    );

    if (!response.SecretString) {
        throw new Error(
            'Database secret does not contain SecretString.'
        );
    }

    let secret;

    try {
        secret = JSON.parse(response.SecretString);
    } catch (error) {
        throw new Error(
            'Database secret is not valid JSON.'
        );
    }

    if (!secret.username) {
        throw new Error(
            'Database secret does not contain username.'
        );
    }

    if (!secret.password) {
        throw new Error(
            'Database secret does not contain password.'
        );
    }

    console.log(
        'Database credentials retrieved successfully.'
    );

    return {
        username: secret.username,
        password: secret.password
    };
}


/* ============================================================================
 * CHECKSUM
 * ========================================================================== */

function calculateChecksum(content) {

    return crypto
        .createHash('sha256')
        .update(content, 'utf8')
        .digest('hex');
}


/* ============================================================================
 * DISCOVER MIGRATIONS
 * ========================================================================== */

function discoverMigrations(directory) {

    console.log(
        `Searching for migrations in: ${directory}`
    );

    if (!fs.existsSync(directory)) {
        throw new Error(
            `Migration directory does not exist: ${directory}`
        );
    }

    const files = fs.readdirSync(directory);

    const migrations = files
        .filter(file => MIGRATION_PATTERN.test(file))
        .map(file => {

            const match = file.match(MIGRATION_PATTERN);

            const version = match[1];

            const description =
                match[2].replace(/_/g, ' ');

            const filePath =
                path.join(directory, file);

            const sql =
                fs.readFileSync(filePath, 'utf8');

            const checksum =
                calculateChecksum(sql);

            return {
                version,
                description,
                filename: file,
                filePath,
                sql,
                checksum
            };
        });

    migrations.sort((a, b) => {

        const versionA =
            Number(a.version.substring(1));

        const versionB =
            Number(b.version.substring(1));

        return versionA - versionB;
    });

    const versions = new Set();

    for (const migration of migrations) {

        if (versions.has(migration.version)) {
            throw new Error(
                `Duplicate migration version detected: ${migration.version}`
            );
        }

        versions.add(migration.version);
    }

    console.log(
        `${migrations.length} migration(s) discovered.`
    );

    for (const migration of migrations) {
        console.log(
            `Migration discovered: ${migration.version} - ${migration.description}`
        );
    }

    return migrations;
}


/* ============================================================================
 * DATABASE CONNECTION
 * ========================================================================== */

async function createDatabaseConnection(config) {

    console.log(
        'Connecting to FairWork Pulse RDS MySQL database.'
    );

    const connection =
        await mysql.createConnection({

            host: config.host,
            port: config.port,
            user: config.username,
            password: config.password,
            database: config.database,

            charset: 'utf8mb4',

            connectTimeout: 10000,

            /*
             * Required because our trusted migration and seed SQL files
             * contain multiple SQL statements.
             */
            multipleStatements: true
        });

    console.log(
        'RDS MySQL connection established successfully.'
    );

    return connection;
}


/* ============================================================================
 * MIGRATION HISTORY
 * ========================================================================== */

async function ensureMigrationHistoryTable(connection) {

    console.log(
        'Checking schema_migrations table.'
    );

    const sql = `

        CREATE TABLE IF NOT EXISTS schema_migrations (

            version VARCHAR(20)
                NOT NULL,

            description VARCHAR(255)
                NOT NULL,

            filename VARCHAR(255)
                NOT NULL,

            checksum CHAR(64)
                NOT NULL,

            applied_at TIMESTAMP
                NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (version),

            UNIQUE KEY
                uq_schema_migrations_filename
                (filename)

        )

        ENGINE=InnoDB

        DEFAULT CHARSET=utf8mb4

        COLLATE=utf8mb4_unicode_ci

    `;

    await connection.query(sql);

    console.log(
        'schema_migrations table is ready.'
    );
}


/* ============================================================================
 * READ APPLIED MIGRATIONS
 * ========================================================================== */

async function getAppliedMigrations(connection) {

    const [rows] =
        await connection.query(`

            SELECT
                version,
                description,
                filename,
                checksum,
                applied_at

            FROM schema_migrations

            ORDER BY version

        `);

    const migrations = new Map();

    for (const row of rows) {
        migrations.set(
            row.version,
            row
        );
    }

    console.log(
        `${migrations.size} migration(s) already recorded in RDS.`
    );

    return migrations;
}


/* ============================================================================
 * VALIDATE EXISTING MIGRATION
 * ========================================================================== */

function validateExistingMigration(
    migration,
    existingMigration
) {

    if (
        existingMigration.checksum
        !== migration.checksum
    ) {

        throw new Error(
            `${migration.version} has already been applied, ` +
            'but the migration file has changed. ' +
            'Applied migrations must never be modified. ' +
            'Create a new migration version instead.'
        );
    }
}


/* ============================================================================
 * APPLY MIGRATION
 * ========================================================================== */

async function applyMigration(
    connection,
    migration
) {

    console.log(
        '------------------------------------------------'
    );

    console.log(
        `Applying ${migration.version}: ${migration.description}`
    );

    console.log(
        `Migration file: ${migration.filename}`
    );

    await connection.query(
        migration.sql
    );

    await connection.execute(
        `

            INSERT INTO schema_migrations (
                version,
                description,
                filename,
                checksum
            )

            VALUES (?, ?, ?, ?)

        `,
        [
            migration.version,
            migration.description,
            migration.filename,
            migration.checksum
        ]
    );

    console.log(
        `${migration.version} applied successfully.`
    );

    console.log(
        '------------------------------------------------'
    );
}


/* ============================================================================
 * RUN MIGRATIONS
 * ========================================================================== */

async function runMigrations(
    connection,
    databaseName
) {

    const migrationDirectory =
        path.join(
            __dirname,
            'migrations'
        );

    const migrations =
        discoverMigrations(
            migrationDirectory
        );

    if (migrations.length === 0) {
        throw new Error(
            'No V###__*.sql migration files were found.'
        );
    }

    await ensureMigrationHistoryTable(
        connection
    );

    const appliedMigrations =
        await getAppliedMigrations(
            connection
        );

    const appliedNow = [];
    const skipped = [];

    for (const migration of migrations) {

        const existingMigration =
            appliedMigrations.get(
                migration.version
            );

        if (existingMigration) {

            validateExistingMigration(
                migration,
                existingMigration
            );

            console.log(
                `Skipping ${migration.version}: migration already applied.`
            );

            skipped.push(
                migration.version
            );

            continue;
        }

        await applyMigration(
            connection,
            migration
        );

        appliedNow.push(
            migration.version
        );
    }

    console.log(
        'Database migration completed successfully.'
    );

    return {

        statusCode: 200,

        body: JSON.stringify({

            success: true,

            action: 'migrate',

            database:
                databaseName,

            migrationsFound:
                migrations.length,

            migrationsApplied:
                appliedNow,

            migrationsSkipped:
                skipped,

            message:
                appliedNow.length > 0
                    ? 'Database migrations completed successfully.'
                    : 'Database is already up to date.'
        })
    };
}


/* ============================================================================
 * DEVELOPMENT SEED
 * ========================================================================== */

async function runDevelopmentSeed(
    connection,
    databaseName
) {

    console.log(
        '================================================'
    );

    console.log(
        'FairWork Pulse Development Seed'
    );

    console.log(
        '================================================'
    );

    const seedDirectory =
        path.join(
            __dirname,
            'seeds'
        );

    const seedFilePath =
        path.join(
            seedDirectory,
            DEVELOPMENT_SEED_FILENAME
        );

    if (!fs.existsSync(seedFilePath)) {

        throw new Error(
            `Development seed file does not exist: ${seedFilePath}`
        );
    }

    const seedSql =
        fs.readFileSync(
            seedFilePath,
            'utf8'
        );

    if (!seedSql.trim()) {

        throw new Error(
            'Development seed SQL file is empty.'
        );
    }

    console.log(
        `Executing ${DEVELOPMENT_SEED_FILENAME}.`
    );

    /*
     * development_seed.sql contains its own START TRANSACTION and COMMIT.
     */
    await connection.query(
        seedSql
    );

    console.log(
        'Development seed SQL executed successfully.'
    );


    /*
     * Get useful counts after seeding.
     */

    const tables = [
        'user_profiles',
        'companies',
        'workplace_associations',
        'employer_company_access',
        'reviews',
        'wellbeing_checkins',
        'moderation_rules'
    ];

    const counts = {};

    for (const table of tables) {

        /*
         * Table names come from the hard-coded list above,
         * not from user input.
         */

        const [rows] =
            await connection.query(
                `SELECT COUNT(*) AS row_count FROM \`${table}\``
            );

        counts[table] =
            Number(
                rows[0].row_count
            );
    }

    console.log(
        'Development seed completed successfully.'
    );

    console.log(
        counts
    );

    return {

        statusCode: 200,

        body: JSON.stringify({

            success: true,

            action: 'seed',

            database:
                databaseName,

            seedFile:
                DEVELOPMENT_SEED_FILENAME,

            counts,

            message:
                'Development seed completed successfully.'
        })
    };
}


/* ============================================================================
 * LAMBDA HANDLER
 * ========================================================================== */

exports.handler = async (event = {}) => {

    let connection = null;

    try {

        /*
         * If no action is supplied, use migrate.
         *
         * This preserves the behaviour of your existing GitHub workflow,
         * which currently invokes the Lambda with {}.
         */

        const action =
            typeof event.action === 'string'
                ? event.action.trim().toLowerCase()
                : 'migrate';


        if (!ALLOWED_ACTIONS.has(action)) {

            return {

                statusCode: 400,

                body: JSON.stringify({

                    success: false,

                    action,

                    message:
                        'Unsupported action. Allowed actions are "migrate" and "seed".'
                })
            };
        }


        console.log(
            '================================================'
        );

        console.log(
            'FairWork Pulse Database Lambda'
        );

        console.log(
            `Requested action: ${action}`
        );

        console.log(
            '================================================'
        );


        /* ====================================================================
         * CONFIGURATION
         * ================================================================== */

        const region =
            process.env.AWS_REGION
            || 'us-east-1';


        const databaseHost =
            getRequiredEnvironmentVariable(
                'DB_HOST'
            );


        const databasePort =
            Number(
                process.env.DB_PORT
                || '3306'
            );


        const databaseName =
            getRequiredEnvironmentVariable(
                'DB_NAME'
            );


        const databaseSecretArn =
            getRequiredEnvironmentVariable(
                'DB_SECRET_ARN'
            );


        if (
            !Number.isInteger(databasePort)
            ||
            databasePort < 1
            ||
            databasePort > 65535
        ) {

            throw new Error(
                'DB_PORT must contain a valid TCP port number.'
            );
        }


        console.log(
            `AWS Region: ${region}`
        );

        console.log(
            `Database name: ${databaseName}`
        );

        console.log(
            `Database port: ${databasePort}`
        );


        /* ====================================================================
         * CREDENTIALS
         * ================================================================== */

        const credentials =
            await getDatabaseCredentials(
                databaseSecretArn,
                region
            );


        /* ====================================================================
         * DATABASE CONNECTION
         * ================================================================== */

        connection =
            await createDatabaseConnection({

                host:
                    databaseHost,

                port:
                    databasePort,

                database:
                    databaseName,

                username:
                    credentials.username,

                password:
                    credentials.password
            });


        /* ====================================================================
         * CHOOSE OPERATION
         * ================================================================== */

        if (action === 'seed') {

            return await runDevelopmentSeed(
                connection,
                databaseName
            );
        }


        return await runMigrations(
            connection,
            databaseName
        );


    } catch (error) {

        console.error(
            '================================================'
        );

        console.error(
            'FairWork Pulse database operation FAILED.'
        );

        console.error(
            error
        );

        console.error(
            '================================================'
        );

        throw new Error(
            `Database operation failed: ${error.message}`
        );


    } finally {

        if (connection) {

            try {

                await connection.end();

                console.log(
                    'RDS database connection closed.'
                );

            } catch (closeError) {

                console.error(
                    'Error closing RDS connection:',
                    closeError
                );
            }
        }
    }
};
