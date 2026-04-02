# Debug Logging System (Querystring + Scoped Logging)

## Overview

Logging is controlled via querystring parameters:

```
?log=<level>&scope=<scope>
```

A **page reload is required** after changing values.

---

# Supported Log Levels

| Level | Behavior                 |
| ----- | ------------------------ |
| none  | No logs                  |
| error | Errors only              |
| warn  | Warnings + errors        |
| info  | Info + warn + error      |
| debug | Debug + everything above |
| all   | Everything               |

---

# Scoped Logging

Scope allow you to filter logs by component or module.

```
?log=debug&scope=UserProfile
```

Multiple scopes:

```
?log=debug&scope=UserProfile,Navbar
```

---

# Querystring Examples

## Log Levels

```
?log=none
?log=error
?log=warn
?log=info
?log=debug
?log=all
```

## Scoped Examples

```
?log=debug&scope=UserProfile
```

```
?log=debug&scope=Navbar,Sidebar
```

## Practical Combinations

### Debug one component only

```
?log=debug&scope=UserProfile
```

### Debug multiple UI areas

```
?log=debug&scope=Navbar,Dashboard
```

### Only show API errors

```
?log=error&scope=API
```

### Default (silent)

```
(no params) → behaves like ?log=none
```

---

# Usage in Components

## Basic Logger

```jsx
import { useDebug } from '../debug';

function Example() {
  const { logger } = useDebug();

  logger.info('App started');

  return null;
}
```

---

## Scoped Logger (Recommended)

```jsx
import { useLogger } from '../debug';

function UserProfile({ user }) {
  const logger = useLogger('UserProfile');

  logger.debug('render start');

  if (!user) {
    logger.warn('missing user');
    return null;
  }

  logger.info('rendering user', user.id);

  return <div>{user.name}</div>;
}
```

---

# Replacing console.\*

| Before                            | After                          |
| --------------------------------- | ------------------------------ |
| `jsconsole.log('loaded');`        | `logger.debug('loaded');`      |
| `jsconsole.warn('missing data');` | `logger.warn('missing data');` |
| `jsconsole.error('failed');`      | `logger.error('failed');`      |

---

# Scoped Logging Example Output

With:

```
?log=debug&scope=UserProfile
```

Console output:

```
[UserProfile] render start
[UserProfile] rendering user 123
```

Other components will NOT log.
