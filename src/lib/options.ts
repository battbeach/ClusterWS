import {resolve} from 'path';

/**
 * Creates options object from
 * configurations provided by user.
 *
 * Default options:
 *
 * @param {number} port = 3000
 * @param {number} workers = 1
 * @param {number} brokerPort = 9346
 * @param {number} pingPongInterval = 20000
 * @param {boolean} restartWorkerOnFail = false
 *
 * Configuration interface is needed to make
 * some options optional in TypeScript.
 */

export interface Configurations {
    port?: number,
    workers?: number,
    brokerPort?: number,
    pathToWorker: string,
    pingInterval?: number
    restartWorkerOnFail?: boolean,
}

export class Options {
    id: number;
    port: number;
    workers: number;
    brokerPort: number;
    pathToWorker: string;
    pingInterval: number;
    restartWorkerOnFail: boolean;

    constructor(configurations: Configurations) {
        this.port = configurations.port || 3000;
        this.workers = configurations.workers || 1;
        this.brokerPort = configurations.brokerPort || 9346;
        this.pathToWorker = resolve(configurations.pathToWorker);
        this.pingInterval = configurations.pingInterval || 20000;
        this.restartWorkerOnFail = configurations.restartWorkerOnFail || false;
    }
}
