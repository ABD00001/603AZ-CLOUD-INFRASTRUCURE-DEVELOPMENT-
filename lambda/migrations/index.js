'use strict';

/*
 * ============================================================================
 * FairWork Pulse - Database Migration Lambda
 * ============================================================================
 *
 * Runtime: Node.js 18.x
 *
 * Purpose:
 *   This Lambda applies version-controlled SQL migrations to the private
 *   FairWork Pulse Amazon RDS MySQL database.
 *
 * Responsibilities:
 *   1. Read database configuration from Lambda environment variables.
 *   2. Retrieve the RDS username/password from AWS Secrets Manager.
 *   3. Discover packaged SQL migration files.
 *   4. Sort migrations into version order.
 *   5. Connect securely to RDS MySQL.
 *   6. Maintain a schema_migrations history table.
 *   7. Skip migrations that have already been applied.
 *   8. Verify SHA-256 checksums of existing migrations.
 *   9. Apply only new migrations.
 *  10. Record successfully applied migrations.
 *
 * Expected migration naming:
 *
 *   V001__initial_schema.sql
 *   V002__rule_based_moderation_policy.sql
 *   V003__future_change.sql
 *
 * Expected Lambda package:
 *
 *   index.js
 *   package.json
 *   node_modules/
 *   migrations/
 *      V001__initial_schema.sql
 *      V002__rule_based_moderation_policy.sql
 *
 * Required environment variables:
 *
 *   DB_HOST
 *   DB_PORT
 *   DB_NAME
 *   DB_SECRET_ARN
 *
 * ============================================================================
 */


/* ============================================================================
 * DEPENDENCIES
 * ========================================================================== */

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

/*
 * Migration files must follow this format:
 *
 * V001__description.sql
 * V002__description.sql
 *
 * Examples:
 *
 * V001__initial_schema.sql
 * V002__rule_based_moderation_policy.sql
 */

const MIGRATION_PATTERN = /^(V\d{3,})__(.+)\.sql$/;


/* ============================================================================
 * ENVIRONMENT VARIABLE HELPER
 * ========================================================================== */

/*
 * Retrieves a required Lambda environment variable.
 *
 * The Lambda should fail immediately if an important configuration value
 * has not been supplied by CloudFormation.
 */

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

/*
 * Retrieves the RDS username and password from AWS Secrets Manager.
 *
 * Database credentials are deliberately NOT stored in:
 *
 *   - GitHub
 *   - Lambda source code
 *   - CloudFormation parameters
 *
 * Expected secret structure:
 *
 * {
 *     "username": "fwadmin",
 *     "password": "..."
 * }
 */

async function getDatabaseCredentials(secretArn, region) {

    console.log(
        'Retrieving database credentials from AWS Secrets Manager.'
    );


    const secretsManager = new SecretsManagerClient({

        region: region

    });


    const command = new GetSecretValueCommand({

        SecretId: secretArn

    });


    const response = await secretsManager.send(command);


    if (!response.SecretString) {

        throw new Error(
            'Database secret does not contain SecretString.'
        );

    }


    let secret;


    try {

        secret = JSON.parse(
            response.SecretString
        );

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
 * SHA-256 MIGRATION CHECKSUM
 * ========================================================================== */

/*
 * Every migration receives a SHA-256 checksum.
 *
 * Example:
 *
 * V001 is deployed.
 *
 * The checksum is stored in:
 *
 * schema_migrations
 *
 * If somebody later edits V001, its checksum changes.
 *
 * The migration Lambda detects this and stops deployment.
 *
 * This protects migration history.
 */

function calculateChecksum(content) {

    return crypto
        .createHash('sha256')
        .update(content, 'utf8')
        .digest('hex');

}


/* ============================================================================
 * DISCOVER DATABASE MIGRATIONS
 * ========================================================================== */

/*
 * Finds SQL migration files packaged with the Lambda.
 *
 * Example:
 *
 * migrations/
 *
 *     V001__initial_schema.sql
 *     V002__rule_based_moderation_policy.sql
 *
 * The migrations are sorted numerically before execution.
 */

function discoverMigrations(directory) {

    console.log(
        `Searching for migrations in: ${directory}`
    );


    /*
     * Check that the migration directory actually exists.
     */

    if (!fs.existsSync(directory)) {

        throw new Error(
            `Migration directory does not exist: ${directory}`
        );

    }


    /*
     * Read files from migration directory.
     */

    const files = fs.readdirSync(directory);


    /*
     * Only accept files matching:
     *
     * V###__description.sql
     */

    const migrations = files

        .filter(file => {

            return MIGRATION_PATTERN.test(file);

        })

        .map(file => {

            const match =
                file.match(MIGRATION_PATTERN);


            const version =
                match[1];


            const description =
                match[2].replace(/_/g, ' ');


            const filePath =
                path.join(
                    directory,
                    file
                );


            /*
             * Read SQL migration.
             */

            const sql =
                fs.readFileSync(
                    filePath,
                    'utf8'
                );


            /*
             * Calculate migration checksum.
             */

            const checksum =
                calculateChecksum(sql);


            return {

                version: version,

                description: description,

                filename: file,

                filePath: filePath,

                sql: sql,

                checksum: checksum

            };

        });


    /*
     * Sort migrations numerically.
     *
     * Correct:
     *
     * V001
     * V002
     * V003
     *
     * rather than relying on filesystem ordering.
     */

    migrations.sort((a, b) => {

        const versionA =
            Number(
                a.version.substring(1)
            );


        const versionB =
            Number(
                b.version.substring(1)
            );


        return versionA - versionB;

    });


    /*
     * Protect against duplicate migration versions.
     *
     * We do NOT want:
     *
     * V002__moderation.sql
     * V002__something_else.sql
     */

    const versions = new Set();


    for (const migration of migrations) {

        if (
            versions.has(
                migration.version
            )
        ) {

            throw new Error(
                `Duplicate migration version detected: ${migration.version}`
            );

        }


        versions.add(
            migration.version
        );

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
 * CREATE DATABASE CONNECTION
 * ========================================================================== */

/*
 * Creates the MySQL connection using mysql2.
 *
 * The Migration Lambda will be placed inside the VPC so it can communicate
 * with the private RDS instance.
 */

async function createDatabaseConnection(config) {

    console.log(
        'Connecting to FairWork Pulse RDS MySQL database.'
    );


    const connection =
        await mysql.createConnection({

            host:
                config.host,

            port:
                config.port,

            user:
                config.username,

            password:
                config.password,

            database:
                config.database,

            charset:
                'utf8mb4',

            connectTimeout:
                10000,

            /*
             * V001 and V002 contain multiple SQL statements.
             *
             * These SQL files are trusted deployment assets packaged with
             * the Lambda.
             */

            multipleStatements:
                true

        });


    console.log(
        'RDS MySQL connection established successfully.'
    );


    return connection;
}


/* ============================================================================
 * CREATE MIGRATION HISTORY TABLE
 * ========================================================================== */

/*
 * schema_migrations is an internal technical table.
 *
 * It records which database versions have already been installed.
 *
 * Example:
 *
 * version | filename                       | applied_at
 * -----------------------------------------------------------
 * V001    | V001__initial_schema.sql       | ...
 * V002    | V002__rule_based_....sql       | ...
 */

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

/*
 * Reads all migrations already recorded in RDS.
 *
 * These are converted into a JavaScript Map:
 *
 * V001 -> migration information
 * V002 -> migration information
 */

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


    const migrations =
        new Map();


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

/*
 * If a migration has already been applied, compare the stored checksum
 * against the current migration file.
 *
 * Example:
 *
 * Stored V001 checksum:
 * ABC123...
 *
 * Current V001 checksum:
 * ABC123...
 *
 * -> safe
 *
 *
 * If:
 *
 * Stored:
 * ABC123...
 *
 * Current:
 * XYZ789...
 *
 * -> V001 was changed after deployment
 * -> deployment stops
 */

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
 * APPLY DATABASE MIGRATION
 * ========================================================================== */

/*
 * Executes a migration.
 *
 * Important:
 *
 * MySQL DDL operations such as CREATE TABLE can perform implicit commits.
 *
 * Therefore we do NOT pretend that an entire schema migration is completely
 * transactional.
 *
 * The migration is only inserted into schema_migrations after its SQL has
 * completed successfully.
 */

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


    /*
     * Execute SQL from migration file.
     */

    await connection.query(
        migration.sql
    );


    /*
     * Record migration only after successful execution.
     */

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
 * LAMBDA HANDLER
 * ========================================================================== */

exports.handler = async () => {

    let connection = null;


    console.log(
        '================================================'
    );


    console.log(
        'FairWork Pulse Database Migration'
    );


    console.log(
        'Migration process started.'
    );


    console.log(
        '================================================'
    );


    try {

        /* ====================================================================
         * STEP 1
         * READ LAMBDA CONFIGURATION
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


        /*
         * Validate database port.
         */

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


        /*
         * Deliberately do NOT print:
         *
         * username
         * password
         * SecretString
         */


        /* ====================================================================
         * STEP 2
         * DISCOVER SQL MIGRATIONS
         * ================================================================== */

        const migrationDirectory =
            path.join(
                __dirname,
                'migrations'
            );


        const migrations =
            discoverMigrations(
                migrationDirectory
            );


        if (
            migrations.length === 0
        ) {

            throw new Error(
                'No V###__*.sql migration files were found.'
            );

        }


        /* ====================================================================
         * STEP 3
         * RETRIEVE RDS CREDENTIALS
         * ================================================================== */

        const credentials =
            await getDatabaseCredentials(
                databaseSecretArn,
                region
            );


        /* ====================================================================
         * STEP 4
         * CONNECT TO RDS MYSQL
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
         * STEP 5
         * CREATE/CHECK MIGRATION HISTORY
         * ================================================================== */

        await ensureMigrationHistoryTable(
            connection
        );


        /* ====================================================================
         * STEP 6
         * READ PREVIOUSLY APPLIED MIGRATIONS
         * ================================================================== */

        const appliedMigrations =
            await getAppliedMigrations(
                connection
            );


        /*
         * Track what happens during this execution.
         */

        const appliedNow = [];

        const skipped = [];


        /* ====================================================================
         * STEP 7
         * PROCESS MIGRATIONS
         * ================================================================== */

        for (
            const migration
            of migrations
        ) {

            const existingMigration =
                appliedMigrations.get(
                    migration.version
                );


            /*
             * --------------------------------------------------------------
             * MIGRATION ALREADY EXISTS
             * --------------------------------------------------------------
             */

            if (existingMigration) {

                /*
                 * Check that the migration has not been changed since
                 * it was originally deployed.
                 */

                validateExistingMigration(
                    migration,
                    existingMigration
                );


                console.log(

                    `Skipping ${migration.version}: ` +
                    'migration already applied.'

                );


                skipped.push(
                    migration.version
                );


                continue;

            }


            /*
             * --------------------------------------------------------------
             * NEW MIGRATION
             * --------------------------------------------------------------
             */

            await applyMigration(
                connection,
                migration
            );


            appliedNow.push(
                migration.version
            );

        }


        /* ====================================================================
         * STEP 8
         * SUCCESS
         * ================================================================== */

        console.log(
            '================================================'
        );


        console.log(
            'Database migration completed successfully.'
        );


        console.log(
            `Applied now: ${appliedNow.length}`
        );


        console.log(
            `Skipped: ${skipped.length}`
        );


        console.log(
            '================================================'
        );


        /*
         * Return a deployment-friendly result.
         */

        return {

            statusCode: 200,

            body: JSON.stringify({

                success: true,

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


    } catch (error) {

        /* ====================================================================
         * FAILURE
         * ================================================================== */

        console.error(
            '================================================'
        );


        console.error(
            'FairWork Pulse database migration FAILED.'
        );


        console.error(
            error
        );


        console.error(
            '================================================'
        );


        /*
         * Throwing causes the Lambda invocation to fail.
         *
         * GitHub Actions / deployment tooling can therefore detect the
         * failure rather than treating a broken migration as successful.
         */

        throw new Error(
            `Database migration failed: ${error.message}`
        );


    } finally {

        /* ====================================================================
         * CLEANUP
         * ================================================================== */

        if (connection) {

            try {

                await connection.end();


                console.log(
                    'RDS database connection closed.'
                );


            } catch (closeError) {

                /*
                 * Connection-close failure should be logged but should not
                 * replace the original migration error.
                 */

                console.error(
                    'Error closing RDS connection:',
                    closeError
                );

            }

        }

    }

};
