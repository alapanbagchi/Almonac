# Runbook: Zitadel masterkey escrow

## Scope

The Zitadel masterkey encrypts sensitive values in the identity database. It is exactly 32 bytes. It must exist in the secret manager and in offline escrow with dual control.

This runbook creates the escrow copy, retrieves it during a restore and replaces it after a suspected exposure.

## Rules

- Two people are required for every retrieval. Neither person can complete the procedure alone.
- Never print the key, paste it into a ticket, send it in chat or store it in a password manager that one person controls.
- Never commit the key. Never place it in Helm values, a container image or CI output.
- A key change is not a routine rotation. It needs a migration plan, because existing ciphertext must remain readable.

## Create the escrow copy

1. Generate the key once, with a reviewed random source. The value is 32 bytes.
2. Store it in the secret manager under a name that identifies the environment and the purpose.
3. Write the escrow copy to two sealed physical media, each held by a different custodian.
4. Record the custodian names, the storage location, the creation date and the check date. Do not record the key.
5. Test retrieval in staging with two people. Record the result.

## Retrieve during a restore

1. Confirm the incident and the restore point.
2. Both custodians retrieve their copy.
3. Compare the copies without printing them. Use a checksum over the value in a controlled shell.
4. Load the key into the secret manager or the Kubernetes Secret that the release expects.
5. Delete temporary files and clear shell history.
6. Record who retrieved the key and when.

## Suspected exposure

1. Treat the identity database as compromised. Revoke administrator sessions and rotate the Zitadel client secret.
2. Plan a key replacement with a migration that re-encrypts affected values. Do not simply replace the key; old ciphertext becomes unreadable.
3. Record the exposure window and the affected data.
4. Replace the escrow copies after the migration.

## Verification

- The secret exists, has the expected name and is 32 bytes.
- Neither copy is readable by one person alone.
- A staging restore with the escrowed key succeeds.

## Known gaps

- No escrow exists yet. This is a process control that engineering cannot verify alone.
- The annual retrieval test has not run.
