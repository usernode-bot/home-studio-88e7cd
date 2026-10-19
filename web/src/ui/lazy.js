// A lazy component whose failed chunk load can be tried again. React.lazy
// caches the rejection, so a retry needs a fresh one: the ChunkBoundary
// that caught the failure calls reset() before the panel is reopened.

import React, { lazy } from 'react';

export function retryable(load) {
  let Inner = lazy(load);
  return {
    // A stable outer component; the inner lazy one is swapped on reset.
    Component: (props) => React.createElement(Inner, props),
    reset() {
      Inner = lazy(load);
    },
  };
}