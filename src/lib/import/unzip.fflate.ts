import { unzip as fflateUnzipCb } from 'fflate';
import type { Unzip } from './unzip';

/** fflate-backed implementation of the {@link Unzip} port. */
export const fflateUnzip: Unzip = (data) =>
  new Promise((resolve, reject) => {
    fflateUnzipCb(data, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
