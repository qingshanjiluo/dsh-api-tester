import React from 'react';
import { createSettingsCard } from '@deepseek-ai/dsh-settings';

export default createSettingsCard({
  title: 'api-tester',
  description: 'API 测试客户端',
  config: [
    { key: 'enabled', type: 'boolean', label: '启用插件', default: true },
    { key: 'defaultTimeout', type: 'number', label: '请求超时(ms)', default: 30000 },
    { key: 'followRedirects', type: 'boolean', label: '跟随重定向', default: true },
    { key: 'verifySsl', type: 'boolean', label: '验证 SSL', default: true },
  ],
});
