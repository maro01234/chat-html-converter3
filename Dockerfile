FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /build
COPY src/ ./src/
COPY tests/ConverterTest.java ./tests/ConverterTest.java
RUN mkdir out && javac --release 21 --add-modules jdk.httpserver -encoding UTF-8 -d out src/*.java tests/ConverterTest.java && java -cp out ConverterTest && rm out/ConverterTest.class

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=build /build/out/ ./out/
COPY public/ ./public/
USER 10001:10001
ENV PORT=10000
EXPOSE 10000
CMD ["java", "-XX:MaxRAMPercentage=60.0", "--add-modules", "jdk.httpserver", "-cp", "out", "WebServer"]
