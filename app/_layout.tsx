import { Stack } from 'expo-router';
import Head from 'expo-router/head';

export default function Layout() {
  return (
    <>
      <Head>
        <title>ManaJudge</title>
      </Head>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="ruling/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
