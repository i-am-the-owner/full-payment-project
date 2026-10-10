import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.almapay.almapay"
    // flutter_secure_storage and permission_handler require compiling against API 37.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    buildFeatures {
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.almapay.almapay"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Two flavours. "app" is the real SomPay. "demo" is a sample-data build with no
    // backend: its own application id (so it never replaces or mixes with the real
    // app), its own name, and NO internet or camera permission. Build it with
    //   flutter build apk --release --flavor demo -t lib/main_demo.dart \
    //     --dart-define=ALMAPAY_ENV=demo --dart-define=ALMAPAY_DEMO_RELEASE=true
    // The real app is built with --flavor app.
    flavorDimensions += "mode"
    productFlavors {
        create("app") {
            dimension = "mode"
            resValue("string", "app_name", "AaminPay")
        }
        create("demo") {
            dimension = "mode"
            applicationIdSuffix = ".demo"
            versionNameSuffix = "-demo"
            resValue("string", "app_name", "AaminPay Demo")
        }
    }

    // Release signing. The keystore and its passwords live OUTSIDE git:
    // android/key.properties (git-ignored) with storeFile, storePassword,
    // keyAlias and keyPassword. A release build with no key.properties is
    // refused, so the app can never be shipped signed with the debug key. To try a
    // release build locally anyway: -PallowDebugSigning=true.
    val keystoreFile = rootProject.file("key.properties")
    val keystore = Properties()
    if (keystoreFile.exists()) {
        keystoreFile.inputStream().use { keystore.load(it) }
    }
    val taskNames = gradle.startParameter.taskNames
    val wantsRelease = taskNames.any { it.contains("release", ignoreCase = true) }
    val wantsDemo = taskNames.any { it.contains("demo", ignoreCase = true) }
    // The demo is never signed with the real key (it uses the debug key), and the
    // real app is never signed with the debug key.
    if (wantsRelease && !wantsDemo && !keystoreFile.exists() && !project.hasProperty("allowDebugSigning")) {
        throw GradleException(
            "No android/key.properties: a release build must be signed with the release key. " +
                "See GO_LIVE.md (mobile release). For a local trial only, pass -PallowDebugSigning=true."
        )
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig =
                if (keystoreFile.exists() && !wantsDemo) signingConfigs.getByName("release")
                else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
