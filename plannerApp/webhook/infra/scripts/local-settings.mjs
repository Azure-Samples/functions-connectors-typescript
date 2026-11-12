// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';

try {
    await copyFile(
        new URL('../../local.settings.example.json', import.meta.url),
        new URL('../../local.settings.json', import.meta.url),
        constants.COPYFILE_EXCL,
    );
    console.log('Created local.settings.json. Configure its placeholders before starting the Functions host.');
} catch (error) {
    if (error.code !== 'EEXIST') throw error;
}
