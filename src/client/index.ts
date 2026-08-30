import React from 'react';

export const inject = ['settingsScope', 'slots', 'locale'];

const zh = {
  enabled: '启用 API Tester',
  followRedirects: '跟随重定向',
  verifySsl: '验证 SSL',
  defaultTimeout: '默认超时 (ms)',
};

const en = {
  enabled: 'Enable API Tester',
  followRedirects: 'Follow Redirects',
  verifySsl: 'Verify SSL',
  defaultTimeout: 'Default Timeout (ms)',
};

export function apply(ctx: any) {
  const { settingsScope, slots, locale } = ctx;

  locale.register('dsh-api-tester', { zh, en });

  slots.register('settings:after', () => {
    const Card = APICard;
    return React.createElement(Card, { settingsScope });
  });
}

function APICard({ settingsScope }: { settingsScope: any }) {
  const { t } = settingsScope.useLocale();
  const config = settingsScope.useConfig();

  const handleChange = (key: string, value: any) => {
    settingsScope.updateConfig({ [key]: value });
  };

  return React.createElement(
    'div',
    { className: 'card' },
    React.createElement('h3', null, 'API Tester'),
    React.createElement(
      'div',
      { className: 'field' },
      React.createElement('label', null, t('enabled')),
      React.createElement('input', {
        type: 'checkbox',
        checked: config.enabled ?? true,
        onChange: (e: any) => handleChange('enabled', e.target.checked),
      })
    ),
    React.createElement(
      'div',
      { className: 'field' },
      React.createElement('label', null, t('followRedirects')),
      React.createElement('input', {
        type: 'checkbox',
        checked: config.followRedirects ?? true,
        onChange: (e: any) => handleChange('followRedirects', e.target.checked),
      })
    ),
    React.createElement(
      'div',
      { className: 'field' },
      React.createElement('label', null, t('verifySsl')),
      React.createElement('input', {
        type: 'checkbox',
        checked: config.verifySsl ?? true,
        onChange: (e: any) => handleChange('verifySsl', e.target.checked),
      })
    ),
    React.createElement(
      'div',
      { className: 'field' },
      React.createElement('label', null, t('defaultTimeout')),
      React.createElement('input', {
        type: 'number',
        value: config.defaultTimeout ?? 30000,
        onChange: (e: any) => handleChange('defaultTimeout', Number(e.target.value)),
      })
    )
  );
}
