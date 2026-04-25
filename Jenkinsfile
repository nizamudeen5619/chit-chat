pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'berserker619/main-api'
        DOCKER_TAG   = "${BUILD_NUMBER}"
    }

    stages {

        stage('Checkout') {
            steps {
                git branch: 'main',
                    credentialsId: 'github-credentials',
                    url: 'https://github.com/nizamudeen5619/chit-chat.git'
            }
        }

        stage('Install') {
            agent {
                docker { image 'node:20-alpine' }
            }
            steps {
                sh 'npm install'
            }
        }

        stage('Docker Build') {
            steps {
                sh "docker build -t ${DOCKER_IMAGE}:${DOCKER_TAG} ."
                sh "docker tag ${DOCKER_IMAGE}:${DOCKER_TAG} ${DOCKER_IMAGE}:latest"
            }
        }

        stage('Docker Push') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-credentials',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh 'echo $DOCKER_PASS | docker login -u $DOCKER_USER --password-stdin'
                    sh "docker push ${DOCKER_IMAGE}:${DOCKER_TAG}"
                    sh "docker push ${DOCKER_IMAGE}:latest"
                }
            }
        }

        stage('Deploy') {
            steps {
                sh """
                    docker-compose down || true
                    docker-compose pull
                    docker-compose up -d
                """
            }
        }

        stage('Health Check') {
            steps {
                sh 'sleep 10'
                sh 'docker exec chit-chat-chit-chat-1 wget -f http://localhost:3000/health || exit 1'
            }
        }
    }

    post {
        success { echo 'Deployment successful! ✅' }
        failure  { echo 'Deployment failed! ❌' }
    }
}