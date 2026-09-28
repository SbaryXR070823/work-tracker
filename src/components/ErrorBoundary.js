import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { clearLastError, loadLastError } from '../utils/errorReporter';

/**
 * Turns a render-time exception into a readable screen. Without this, React
 * Native release builds close the app instantly and show nothing at all.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, previousError: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    loadLastError().then((previousError) => {
      if (previousError) this.setState({ previousError });
    });
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error:', error, info && info.componentStack);
  }

  handleReset = () => {
    clearLastError();
    this.setState({ error: null, previousError: null });
  };

  render() {
    const { error, previousError } = this.state;
    if (!error) return this.props.children;

    const showPrevious =
      previousError &&
      (previousError.message !== String(error.message) ||
        previousError.stack !== String(error.stack || ''));

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>{String((error && error.message) || error)}</Text>

        {error && error.stack ? (
          <>
            <Text style={styles.label}>Stack trace</Text>
            <Text style={styles.code}>{String(error.stack)}</Text>
          </>
        ) : null}

        {showPrevious ? (
          <>
            <Text style={styles.label}>Last recorded error</Text>
            <Text style={styles.code}>
              {previousError.time}
              {'\n'}
              {previousError.message}
            </Text>
          </>
        ) : null}

        <TouchableOpacity style={styles.button} onPress={this.handleReset}>
          <Text style={styles.buttonText}>Dismiss</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#b71c1c',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: '#333',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  code: {
    fontSize: 11,
    color: '#444',
    backgroundColor: '#eceff1',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#1976d2',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
