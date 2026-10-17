// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import { GestureHandlerRootView } from '@amazon-devices/react-native-gesture-handler';
import { PopcornRoot } from '@multi-tv/shared-ui';

export const App = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PopcornRoot />
    </GestureHandlerRootView>
  );
};