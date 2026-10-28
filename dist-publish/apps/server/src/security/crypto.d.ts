export declare class AuthenticationTagMismatchError extends Error {
    constructor(message?: string);
}
export declare function encryptSecret(plainText: string, masterKeyHex: string): string;
export declare function decryptSecret(cipherText: string, masterKeyHex: string): string;
